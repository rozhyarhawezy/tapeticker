/* ===================================================================
   TAPE — ticker dashboard frontend
   Vanilla JS. Fetches /api/ohlcv, /api/fastinfo, /api/info and renders
   a hand-rolled canvas line chart + side panels.
   =================================================================== */

(() => {
  const form        = document.getElementById("lookupForm");
  const symbolInput = document.getElementById("symbol");
  const startInput  = document.getElementById("start");
  const endInput    = document.getElementById("end");
  const loadBtn     = document.getElementById("loadBtn");

  const emptyState   = document.getElementById("emptyState");
  const loadingState = document.getElementById("loadingState");
  const errorState   = document.getElementById("errorState");
  const errorCopy    = document.getElementById("errorCopy");
  const mainLayout   = document.getElementById("mainLayout");
  const tapeStrip    = document.getElementById("tapeStrip");

  const canvas  = document.getElementById("priceChart");
  const ctx     = canvas.getContext("2d");
  const tooltip = document.getElementById("chartTooltip");
  const chartRangeEl = document.getElementById("chartRange");

  const tableToggle = document.getElementById("tableToggle");
  const tableScroll = document.getElementById("tableScroll");
  const toggleIcon  = document.getElementById("toggleIcon");
  const ohlcvBody   = document.getElementById("ohlcvBody");

  const summaryToggle = document.getElementById("summaryToggle");
  const coSummaryEl   = document.getElementById("coSummary");

  let candles = [];   // [{date, open, high, low, close, volume}]

  // ------------------------------------------------------ defaults --- //
  (function setDefaultDates(){
    const today = new Date();
    const yearAgo = new Date();
    yearAgo.setFullYear(today.getFullYear() - 1);
    endInput.value = today.toISOString().slice(0, 10);
    startInput.value = yearAgo.toISOString().slice(0, 10);
  })();

  // ---------------------------------------------------------- utils --- //

  const fmtMoney = (n, decimals = 2) => {
    if (n === null || n === undefined || Number.isNaN(n)) return "–";
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const fmtCompact = (n) => {
    if (n === null || n === undefined || Number.isNaN(n)) return "–";
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);
  };

  const fmtDate = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const fmtDateShort = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  function showState(state){
    emptyState.hidden   = state !== "empty";
    loadingState.hidden = state !== "loading";
    errorState.hidden   = state !== "error";
    mainLayout.hidden   = state !== "data";
    document.getElementById("statusArea").hidden = state === "data";
  }

  // -------------------------------------------------------- fetching -- //

  async function fetchJSON(url){
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok){
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!symbol) return;

    const start = startInput.value;
    const end = endInput.value;

    loadBtn.disabled = true;
    showState("loading");

    try {
      const params = new URLSearchParams({ ticker: symbol });
      if (start) params.set("start", start);
      if (end) params.set("end", end);

      const [ohlcvRes, fastInfoRes, infoRes] = await Promise.allSettled([
        fetchJSON(`/api/ohlcv?${params.toString()}`),
        fetchJSON(`/api/fastinfo?ticker=${encodeURIComponent(symbol)}`),
        fetchJSON(`/api/info?ticker=${encodeURIComponent(symbol)}`),
      ]);

      if (ohlcvRes.status === "rejected"){
        throw new Error(ohlcvRes.reason.message);
      }

      candles = ohlcvRes.value.candles;
      renderChart();
      renderTable();
      chartRangeEl.textContent = candles.length
        ? `· ${fmtDate(candles[0].date)} → ${fmtDate(candles[candles.length - 1].date)}`
        : "";

      if (fastInfoRes.status === "fulfilled"){
        renderFastInfo(fastInfoRes.value.fastInfo, symbol);
      } else {
        renderFastInfoUnavailable();
      }

      if (infoRes.status === "fulfilled"){
        renderCompanyInfo(infoRes.value.info);
      } else {
        renderCompanyInfoUnavailable();
      }

      renderTapeStrip(symbol, fastInfoRes.status === "fulfilled" ? fastInfoRes.value.fastInfo : null);

      showState("data");
    } catch (err){
      errorCopy.textContent = err.message || "Something went wrong. Try again.";
      showState("error");
    } finally {
      loadBtn.disabled = false;
    }
  });

  // ------------------------------------------------------- tape strip -- //

  function renderTapeStrip(symbol, fastInfo){
    tapeStrip.hidden = false;
    document.getElementById("tapeName").textContent = symbol;

    const last = candles.length ? candles[candles.length - 1] : null;
    const price = fastInfo && fastInfo.lastPrice != null ? fastInfo.lastPrice : (last ? last.close : null);
    const prevClose = fastInfo && fastInfo.previousClose != null
      ? fastInfo.previousClose
      : (candles.length > 1 ? candles[candles.length - 2].close : null);

    document.getElementById("tapePrice").textContent = price != null ? fmtMoney(price) : "–";

    const deltaEl = document.getElementById("tapeDelta");
    if (price != null && prevClose != null && prevClose !== 0){
      const diff = price - prevClose;
      const pct = (diff / prevClose) * 100;
      const sign = diff >= 0 ? "+" : "";
      deltaEl.textContent = `${sign}${fmtMoney(diff)} (${sign}${fmtMoney(pct)}%)`;
      deltaEl.classList.toggle("negative", diff < 0);
    } else {
      deltaEl.textContent = "";
    }

    document.getElementById("tapeMeta").textContent = last ? `as of ${fmtDate(last.date)}` : "";
  }

  // ------------------------------------------------------------ chart -- //

  function renderChart(){
    resizeCanvas();
    drawChart();
    if (candles.length){
      updateReadout(candles[candles.length - 1]);
    }
  }

  function resizeCanvas(){
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssHeight = 360;
    canvas.style.height = cssHeight + "px";
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let chartGeom = null; // cached geometry for hit-testing on mousemove

  function drawChart(){
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = 360;
    ctx.clearRect(0, 0, W, H);

    if (!candles.length) return;

    const pad = { top: 16, right: 16, bottom: 28, left: 64 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const closes = candles.map(c => c.close).filter(v => v != null);
    const highs = candles.map(c => c.high).filter(v => v != null);
    const lows = candles.map(c => c.low).filter(v => v != null);
    let min = Math.min(...lows, ...closes);
    let max = Math.max(...highs, ...closes);
    const cushion = (max - min) * 0.08 || max * 0.02 || 1;
    min -= cushion;
    max += cushion;

    const xFor = (i) => pad.left + (candles.length === 1 ? plotW / 2 : (i / (candles.length - 1)) * plotW);
    const yFor = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

    chartGeom = { pad, plotW, plotH, min, max, xFor, yFor, W, H };

    // --- gridlines + y labels ---
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.fillStyle = "#55636F";
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.textBaseline = "middle";
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++){
      const v = min + ((max - min) * i) / ySteps;
      const y = yFor(v);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(fmtMoney(v), pad.left - 10, y);
    }

    // --- x labels (sparse) ---
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const labelCount = Math.min(6, candles.length);
    for (let i = 0; i < labelCount; i++){
      const idx = Math.round((i / Math.max(labelCount - 1, 1)) * (candles.length - 1));
      const x = xFor(idx);
      ctx.fillText(fmtDateShort(candles[idx].date), x, H - 8);
    }

    // --- gradient area under line ---
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, "rgba(69, 211, 176, 0.28)");
    grad.addColorStop(1, "rgba(69, 211, 176, 0.0)");

    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = xFor(i);
      const y = yFor(c.close);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(xFor(candles.length - 1), pad.top + plotH);
    ctx.lineTo(xFor(0), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // --- line ---
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = xFor(i);
      const y = yFor(c.close);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#45D3B0";
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  function updateReadout(candle){
    document.getElementById("rOpen").textContent  = fmtMoney(candle.open);
    document.getElementById("rHigh").textContent  = fmtMoney(candle.high);
    document.getElementById("rLow").textContent   = fmtMoney(candle.low);
    document.getElementById("rClose").textContent = fmtMoney(candle.close);
    document.getElementById("rVol").textContent   = fmtCompact(candle.volume);
  }

  canvas.addEventListener("mousemove", (e) => {
    if (!chartGeom || !candles.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    const { pad, plotW } = chartGeom;
    const ratio = Math.min(Math.max((mx - pad.left) / plotW, 0), 1);
    const idx = Math.round(ratio * (candles.length - 1));
    const c = candles[idx];
    if (!c) return;

    drawChart();
    const x = chartGeom.xFor(idx);
    const y = chartGeom.yFor(c.close);

    // crosshair
    ctx.save();
    ctx.strokeStyle = "rgba(231,168,87,0.6)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, chartGeom.pad.top);
    ctx.lineTo(x, chartGeom.pad.top + chartGeom.plotH);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.fillStyle = "#E7A857";
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    updateReadout(c);

    tooltip.hidden = false;
    tooltip.innerHTML = `
      <span class="tt-date">${fmtDate(c.date)}</span>
      O ${fmtMoney(c.open)} · H ${fmtMoney(c.high)} · L ${fmtMoney(c.low)}<br/>
      C ${fmtMoney(c.close)} · Vol ${fmtCompact(c.volume)}
    `;
    const ttRect = tooltip.getBoundingClientRect();
    let left = x + 14;
    if (left + ttRect.width > rect.width) left = x - ttRect.width - 14;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(chartGeom.pad.top, y - 50)}px`;
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.hidden = true;
    drawChart();
    if (candles.length) updateReadout(candles[candles.length - 1]);
  });

  window.addEventListener("resize", () => {
    if (candles.length){
      resizeCanvas();
      drawChart();
    }
  });

  // ------------------------------------------------------------ table -- //

  function renderTable(){
    ohlcvBody.innerHTML = "";
    const rows = [...candles].reverse(); // most recent first
    for (const c of rows){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtDate(c.date)}</td>
        <td>${fmtMoney(c.open)}</td>
        <td>${fmtMoney(c.high)}</td>
        <td>${fmtMoney(c.low)}</td>
        <td>${fmtMoney(c.close)}</td>
        <td>${fmtCompact(c.volume)}</td>
      `;
      ohlcvBody.appendChild(tr);
    }
  }

  tableToggle.addEventListener("click", () => {
    const expanded = tableToggle.getAttribute("aria-expanded") === "true";
    tableToggle.setAttribute("aria-expanded", String(!expanded));
    tableScroll.hidden = expanded;
    toggleIcon.textContent = expanded ? "＋" : "－";
  });

  // -------------------------------------------------------- fast info -- //

  function renderFastInfo(fi, symbol){
    const currencyPrefix = fi.currency ? "" : "";
    document.getElementById("fiLast").textContent      = fi.lastPrice != null ? fmtMoney(fi.lastPrice) : "–";
    document.getElementById("fiOpen").textContent      = fi.open != null ? fmtMoney(fi.open) : "–";
    document.getElementById("fiHigh").textContent      = fi.dayHigh != null ? fmtMoney(fi.dayHigh) : "–";
    document.getElementById("fiLow").textContent       = fi.dayLow != null ? fmtMoney(fi.dayLow) : "–";
    document.getElementById("fiPrevClose").textContent = fi.previousClose != null ? fmtMoney(fi.previousClose) : "–";
    document.getElementById("fiVolume").textContent    = fi.lastVolume != null ? fmtCompact(fi.lastVolume) : "–";
    document.getElementById("fiMarketCap").textContent = fi.marketCap != null ? fmtCompact(fi.marketCap) : "–";
  }

  function renderFastInfoUnavailable(){
    ["fiLast","fiOpen","fiHigh","fiLow","fiPrevClose","fiVolume","fiMarketCap"].forEach(id => {
      document.getElementById(id).textContent = "–";
    });
  }

  // ------------------------------------------------------ company info -- //

  function renderCompanyInfo(info){
    document.getElementById("coName").textContent = info.longName || "–";

    const tagsEl = document.getElementById("coTags");
    tagsEl.innerHTML = "";
    [info.sector, info.industry].filter(Boolean).forEach(tag => {
      const span = document.createElement("span");
      span.textContent = tag;
      tagsEl.appendChild(span);
    });

    document.getElementById("coCountry").textContent = info.country || "–";
    document.getElementById("coEmployees").textContent = info.fullTimeEmployees != null
      ? Number(info.fullTimeEmployees).toLocaleString()
      : "–";

    const websiteEl = document.getElementById("coWebsite");
    if (info.website){
      websiteEl.innerHTML = `<a href="${info.website}" target="_blank" rel="noopener">${info.website.replace(/^https?:\/\//, "")}</a>`;
    } else {
      websiteEl.textContent = "–";
    }

    const summary = info.longBusinessSummary || "No business summary available.";
    coSummaryEl.textContent = summary;
    coSummaryEl.classList.remove("expanded");
    summaryToggle.hidden = summary.length < 320;
    summaryToggle.textContent = "Read more";
  }

  function renderCompanyInfoUnavailable(){
    document.getElementById("coName").textContent = "Company details unavailable";
    document.getElementById("coTags").innerHTML = "";
    document.getElementById("coCountry").textContent = "–";
    document.getElementById("coEmployees").textContent = "–";
    document.getElementById("coWebsite").textContent = "–";
    coSummaryEl.textContent = "";
    summaryToggle.hidden = true;
  }

  summaryToggle.addEventListener("click", () => {
    const expanded = coSummaryEl.classList.toggle("expanded");
    summaryToggle.textContent = expanded ? "Show less" : "Read more";
  });

  showState("empty");
})();
