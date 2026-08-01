"""
Backend for the ticker dashboard.

Three endpoints, all driven by a ticker symbol the user types in:
  /api/ohlcv    -> historical Open/High/Low/Close/Volume between two dates
  /api/fastinfo -> ticker.fast_info snapshot (price, day range, volume, market cap...)
  /api/info     -> a curated slice of ticker.info (company profile)
"""

from flask import Flask, jsonify, request, send_from_directory
import yfinance as yf
import math

app = Flask(__name__, static_folder="static", template_folder="templates")


# ---------------------------------------------------------------- helpers --

def clean_number(value):
    """Turn NaN / inf / numpy types into plain JSON-safe values."""
    if value is None:
        return None
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return value


def get_ticker_or_404(symbol):
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return None, (jsonify({"error": "Ticker symbol is required."}), 400)
    return symbol, None


# ------------------------------------------------------------------ pages --

@app.route("/")
def index():
    return send_from_directory("templates", "index.html")


# ------------------------------------------------------------------- api --

@app.route("/api/ohlcv")
def api_ohlcv():
    symbol, err = get_ticker_or_404(request.args.get("ticker"))
    if err:
        return err

    start = request.args.get("start") or None
    end = request.args.get("end") or None

    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(start=start, end=end, auto_adjust=False)

        if hist is None or hist.empty:
            return jsonify({"error": f"No price data found for '{symbol}'. "
                                      f"Check the symbol and date range."}), 404

        hist = hist.reset_index()
        date_col = "Date" if "Date" in hist.columns else hist.columns[0]

        rows = []
        for _, row in hist.iterrows():
            rows.append({
                "date": row[date_col].strftime("%Y-%m-%d"),
                "open": clean_number(row.get("Open")),
                "high": clean_number(row.get("High")),
                "low": clean_number(row.get("Low")),
                "close": clean_number(row.get("Close")),
                "volume": clean_number(row.get("Volume")),
            })

        return jsonify({"symbol": symbol, "candles": rows})

    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Couldn't load OHLCV data for '{symbol}': {exc}"}), 502


@app.route("/api/fastinfo")
def api_fastinfo():
    symbol, err = get_ticker_or_404(request.args.get("ticker"))
    if err:
        return err

    try:
        ticker = yf.Ticker(symbol)
        fi = ticker.fast_info

        def pick(key):
            try:
                return clean_number(fi.get(key))
            except Exception:  # noqa: BLE001
                return None

        data = {
            "lastPrice": pick("lastPrice"),
            "dayHigh": pick("dayHigh"),
            "dayLow": pick("dayLow"),
            "open": pick("open"),
            "previousClose": pick("previousClose"),
            "lastVolume": pick("lastVolume"),
            "marketCap": pick("marketCap"),
            "currency": None,
        }
        try:
            data["currency"] = fi.get("currency")
        except Exception:  # noqa: BLE001
            pass

        if data["lastPrice"] is None:
            return jsonify({"error": f"No quote data found for '{symbol}'."}), 404

        return jsonify({"symbol": symbol, "fastInfo": data})

    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Couldn't load fast info for '{symbol}': {exc}"}), 502


@app.route("/api/info")
def api_info():
    symbol, err = get_ticker_or_404(request.args.get("ticker"))
    if err:
        return err

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}

        if not info or info.get("longName") is None and info.get("shortName") is None:
            return jsonify({"error": f"No company info found for '{symbol}'."}), 404

        data = {
            "longName": info.get("longName") or info.get("shortName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "country": info.get("country"),
            "website": info.get("website"),
            "fullTimeEmployees": info.get("fullTimeEmployees"),
            "longBusinessSummary": info.get("longBusinessSummary"),
        }

        return jsonify({"symbol": symbol, "info": data})

    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Couldn't load company info for '{symbol}': {exc}"}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5000)