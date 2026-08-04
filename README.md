# Tape Ticker

Tape Ticker is a simple Flask web application that retrieves historical stock market data using the Yahoo Finance (`yfinance`) API. It allows users to search any stock ticker within a custom date range and provides a daily OHLCV table, and basic company info — all pulled from Yahoo Finance.

## Features

- Search any stock by ticker symbol (e.g., AAPL, MSFT, TSLA)
- Select a custom start and end date
- View historical OHLCV (Open, High, Low, Close, Volume) data
 Interactive line chart of the selected date range
- Interactive OHLCV line charts
- Display basic company information, including:
  - Company name
  - Industry
  - Sector
  - Number of employees
  - Market capitalization
  - Website

## Technologies Used

- Python
- Flask
- yfinance
- HTML
- CSS
- JavaScript

## Running the Application

1. Install the required dependencies:

```bash
pip install -r requirements.txt
```

2. Start the Flask application:

```bash
python app.py
```

3. Open your browser and visit:

```
http://127.0.0.1:5000
```
## Data Source

All market data and company information are provided by Yahoo Finance through the `yfinance` library.

