/* ==========================================================================
   Northpoint Growth Fund — Dashboard logic
   No build step, no bundler: plain ES2017+ running directly in the browser.
   Live data comes from Netlify functions (/.netlify/functions/*), which
   proxy Finnhub (quotes) and Twelve Data (price history) server-side so
   API keys never reach the client. Bigdata.com profile data is baked into
   assets/holdings-data.js as a dated snapshot (see comment there for why).
   ========================================================================== */

(function () {
  "use strict";

  // Dark-theme defaults for Chart.js (axis text/gridlines are invisible against
  // a dark card background using Chart.js's light-theme defaults otherwise).
  if (window.Chart) {
    Chart.defaults.color = "#8a93ad";
    Chart.defaults.font.family = "'Inter', sans-serif";
  }

  const TICKERS = window.HOLDINGS.map((h) => h.ticker);
  const state = {
    quotes: {},       // ticker -> { ok, price, change, percentChange, previousClose, open, high, low, source, error }
    lastSyncUtc: null,
    sortKey: "weight",
    sortDir: "desc",
  };

  const fmtUsd = (n, opts = {}) => {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    const maximumFractionDigits = opts.maximumFractionDigits !== undefined ? opts.maximumFractionDigits : 2;
    const minimumFractionDigits = opts.minimumFractionDigits !== undefined ? opts.minimumFractionDigits : Math.min(2, maximumFractionDigits);
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits, maximumFractionDigits });
  };

  const fmtPct = (n, digits = 2) =>
    n === null || n === undefined || Number.isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

  const fmtSigned = (n) => (n === null || n === undefined || Number.isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${fmtUsd(n)}`);

  const signClass = (n) => (n === null || n === undefined || Number.isNaN(n) ? "" : n >= 0 ? "pos" : "neg");

  // Approximate, commonly-recognized brand colors per ticker — not pulled from
  // an official brand-guidelines API, just well-known associations (Microsoft
  // blue, Visa navy, NVIDIA green, etc.). JPM and AVGO in particular are best
  // guesses, not verified hex values — treat as decorative, not authoritative.
  const BRAND_COLORS = {
    MSFT: "#00A4EF",
    GOOGL: "#4285F4",
    V: "#1A1F71",
    JPM: "#2E5090",
    COST: "#E01A2B",
    NVDA: "#76B900",
    AVGO: "#CC092F",
  };

  function hexToRgba(hex, alpha) {
    const m = (hex || "").replace("#", "");
    if (m.length !== 6) return `rgba(148,163,184,${alpha})`;
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Some brand hexes (Visa navy, JPMorgan navy) are too dark to read as TEXT on
  // this dark-navy UI — they were nearly invisible. This boosts lightness/
  // saturation just for on-screen text/icon color while leaving the original
  // brand hex untouched for the soft tinted badge background.
  function hexToHsl(hex) {
    const m = (hex || "").replace("#", "");
    const r = parseInt(m.substring(0, 2), 16) / 255;
    const g = parseInt(m.substring(2, 4), 16) / 255;
    const b = parseInt(m.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function readableBrand(hex) {
    if (!hex) return "#5b8cff";
    const [h, s, l] = hexToHsl(hex);
    const l2 = Math.min(Math.max(l, 58), 85);
    const s2 = Math.min(Math.max(s, 45), 90);
    return hslToHex(h, s2, l2);
  }

  // Real domain (from holdings-data.js's bigdata.website snapshot) -> a real
  // logo image via Clearbit's public logo endpoint. No fabricated images —
  // if the domain is missing or the logo 404s, the <img> is simply removed.
  function domainFromUrl(url) {
    if (!url) return null;
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }

  function logoUrlFor(website) {
    const domain = domainFromUrl(website);
    return domain ? `https://logo.clearbit.com/${domain}?size=64` : null;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---------------------------------------------------------------------- */
  /* Clock + market status                                                  */
  /* ---------------------------------------------------------------------- */

  function etParts(date) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    const parts = {};
    fmt.formatToParts(date).forEach((p) => (parts[p.type] = p.value));
    return parts;
  }

  function updateClock() {
    const now = new Date();
    const p = etParts(now);
    let hh = p.hour === "24" ? "00" : p.hour;
    document.getElementById("etClock").textContent = `${hh}:${p.minute}:${p.second} ET`;

    const dateFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    document.getElementById("todayDate").textContent = dateFmt.format(now);

    updateMarketStatus(now, p);
  }

  function updateMarketStatus(now, p) {
    const weekday = p.weekday; // Mon, Tue, ...
    const isWeekday = !["Sat", "Sun"].includes(weekday);
    const minutes = (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10);
    const open = 9 * 60 + 30;
    const close = 16 * 60;
    const afterHoursEnd = 20 * 60;

    const dot = document.getElementById("statusDot");
    const label = document.getElementById("statusLabel");
    const pill = document.getElementById("marketStatus");
    dot.className = "status-dot";

    let stateClass;
    if (isWeekday && minutes >= open && minutes < close) {
      stateClass = "open";
      label.textContent = "Market Open";
    } else if (isWeekday && minutes >= close && minutes < afterHoursEnd) {
      stateClass = "after-hours";
      label.textContent = "After Hours";
    } else {
      stateClass = "closed";
      label.textContent = "Market Closed";
    }
    dot.classList.add(stateClass);
    pill.className = `market-status ${stateClass}`;
    label.title = "Based on 9:30am–4:00pm ET, Mon–Fri. U.S. market holidays are not detected — status may be wrong on holidays.";
  }

  /* ---------------------------------------------------------------------- */
  /* Data fetch (Netlify functions)                                        */
  /* ---------------------------------------------------------------------- */

  async function fetchQuotes() {
    const res = await fetch(`/.netlify/functions/quotes?tickers=${TICKERS.join(",")}`);
    if (!res.ok) throw new Error(`quotes endpoint returned HTTP ${res.status}`);
    return res.json();
  }

  // In-memory cache (cleared on full page reload) keyed by ticker+outputsize.
  // Twelve Data's free tier has a daily credit limit, and re-fetching the same
  // ticker/range every time the modal reopens or a range button is re-clicked
  // burns through it fast — which is what was causing "won't show" failures.
  // Daily closes don't change intraday, so re-serving a cached real response
  // is safe; failures are never cached, so a retry can still succeed later.
  const historyCache = {};

  async function fetchHistory(ticker, outputsize, interval = "1day") {
    const cacheKey = `${ticker}_${outputsize}_${interval}`;
    if (historyCache[cacheKey]) return historyCache[cacheKey];
    const res = await fetch(`/.netlify/functions/history?ticker=${encodeURIComponent(ticker)}&outputsize=${outputsize}&interval=${encodeURIComponent(interval)}`);
    if (!res.ok) throw new Error(`history endpoint returned HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.ok) historyCache[cacheKey] = data;
    return data;
  }

  // Fetching 7 tickers' history at once can trip Twelve Data's free-tier rate
  // limit (transient — not a real "no data" situation). One retry after a
  // short pause resolves that without ever inventing a substitute price.
  async function fetchHistoryRetrying(ticker, outputsize, interval = "1day", attempts = 3, retryDelayMs = 1500) {
    let last;
    for (let i = 0; i < attempts; i++) {
      last = await fetchHistory(ticker, outputsize, interval).catch((e) => ({ ok: false, error: e.message }));
      if (last && last.ok) return last;
      if (i < attempts - 1) await delay(retryDelayMs);
    }
    return last;
  }

  /* ---------------------------------------------------------------------- */
  /* Derived portfolio math                                                 */
  /* ---------------------------------------------------------------------- */

  function computeRows() {
    return window.HOLDINGS.map((h) => {
      const q = state.quotes[h.ticker];
      const ok = q && q.ok;
      const price = ok ? q.price : null;
      const marketValue = ok ? price * h.shares : null;
      const dayChangeDollar = ok && q.change != null ? q.change * h.shares : null;
      const dayChangePct = ok ? q.percentChange : null;
      const totalReturnDollar = ok ? (price - h.costBasis) * h.shares : null;
      const totalReturnPct = ok ? ((price - h.costBasis) / h.costBasis) * 100 : null;
      const riskBeta = h.risk ? h.risk.beta : null;
      const riskCategory = h.risk ? h.risk.category : null;
      return { ...h, ok, price, marketValue, dayChangeDollar, dayChangePct, totalReturnDollar, totalReturnPct, riskBeta, riskCategory, error: q && q.error };
    });
  }

  function computeTotals(rows) {
    const okRows = rows.filter((r) => r.ok);
    const holdingsValue = okRows.reduce((s, r) => s + r.marketValue, 0);
    const netWorth = holdingsValue + window.FUND.cashUsd;
    const totalCostBasis = window.HOLDINGS.reduce((s, h) => s + h.costBasis * h.shares, 0);
    const totalInvestedValue = okRows.reduce((s, r) => s + r.marketValue, 0);
    const totalReturnDollar = okRows.reduce((s, r) => s + r.totalReturnDollar, 0);
    // Pct of total return is only meaningful over the cost basis of the holdings that actually priced successfully.
    const pricedCostBasis = okRows.reduce((s, r) => s + r.costBasis * r.shares, 0);
    const totalReturnPct = pricedCostBasis > 0 ? (totalReturnDollar / pricedCostBasis) * 100 : null;
    const dayChangeDollar = okRows.reduce((s, r) => s + (r.dayChangeDollar || 0), 0);
    const prevNetWorth = netWorth - dayChangeDollar;
    const dayChangePct = prevNetWorth > 0 ? (dayChangeDollar / prevNetWorth) * 100 : null;
    return {
      netWorth,
      totalCostBasis,
      totalReturnDollar,
      totalReturnPct,
      dayChangeDollar,
      dayChangePct,
      missingCount: rows.length - okRows.length,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering: KPIs                                                       */
  /* ---------------------------------------------------------------------- */

  function renderKpis(rows, totals) {
    document.getElementById("kpiNetWorth").textContent = fmtUsd(totals.netWorth);
    document.getElementById("kpiNetWorthSub").textContent =
      totals.missingCount > 0 ? `${totals.missingCount} of ${rows.length} prices unavailable — total is partial` : "all positions priced";

    const trEl = document.getElementById("kpiTotalReturn");
    trEl.textContent = fmtSigned(totals.totalReturnDollar);
    trEl.className = `kpi-value ${signClass(totals.totalReturnDollar)}`;
    const trSub = document.getElementById("kpiTotalReturnPct");
    trSub.textContent = fmtPct(totals.totalReturnPct);
    trSub.className = `kpi-sub ${signClass(totals.totalReturnPct)}`;

    const dcEl = document.getElementById("kpiDayChange");
    dcEl.textContent = fmtSigned(totals.dayChangeDollar);
    dcEl.className = `kpi-value ${signClass(totals.dayChangeDollar)}`;
    const dcSub = document.getElementById("kpiDayChangePct");
    dcSub.textContent = fmtPct(totals.dayChangePct);
    dcSub.className = `kpi-sub ${signClass(totals.dayChangePct)}`;

    document.getElementById("kpiCash").textContent = fmtUsd(window.FUND.cashUsd);
    document.getElementById("kpiCashPct").textContent = `${window.FUND.cashPct.toFixed(2)}% of fund`;
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering: holdings table                                              */
  /* ---------------------------------------------------------------------- */

  function sortRows(rows, netWorth) {
    const withWeight = rows.map((r) => ({ ...r, weight: r.ok ? (r.marketValue / netWorth) * 100 : null }));
    const key = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    withWeight.sort((a, b) => {
      let av = a[key], bv = b[key];
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      return (av - bv) * dir;
    });
    return withWeight;
  }

  function renderTable(rows, totals) {
    const sorted = sortRows(rows, totals.netWorth);
    const tbody = document.getElementById("holdingsTbody");
    tbody.innerHTML = "";
    sorted.forEach((r) => {
      const tr = document.createElement("tr");
      const sectorColor = SECTOR_COLORS[r.sector] || "#94a3b8";
      const sectorSoft = hexToRgba(sectorColor, 0.16);
      const sectorBadge = `<span class="sector-badge" style="color:${sectorColor};background:${sectorSoft};">${r.sector}</span>`;
      // Ticker text (no bubble) is colored with the holding's sector color, so a
      // ticker visually groups with its sector without adding another badge shape.
      const logoUrl = logoUrlFor(r.bigdata && r.bigdata.website);
      const logoImg = logoUrl ? `<img class="ticker-logo" src="${logoUrl}" alt="" onerror="this.remove()" />` : "";
      // Ticker is clickable — opens the modal, where Risk Profile (beta/category) now
      // lives instead of its own table column. See openModal() for that rendering.
      const tickerCell = `<span class="ticker-cell">${logoImg}<button class="ticker-btn" data-ticker="${r.ticker}" style="color:${sectorColor};">${r.ticker}</button></span>`;
      if (r.ok) {
        tr.innerHTML = `
          <td>${tickerCell}</td>
          <td>${r.company}</td>
          <td>${sectorBadge}</td>
          <td class="num cell-mono">${r.shares.toLocaleString()}</td>
          <td class="num cell-mono">${fmtUsd(r.costBasis)}</td>
          <td class="num cell-mono">${fmtUsd(r.price)}</td>
          <td class="num cell-mono">${fmtUsd(r.marketValue)}</td>
          <td class="num cell-mono">${r.weight.toFixed(2)}%</td>
          <td class="num cell-mono ${signClass(r.dayChangeDollar)}">${fmtSigned(r.dayChangeDollar)} (${fmtPct(r.dayChangePct)})</td>
          <td class="num cell-mono ${signClass(r.totalReturnDollar)}">${fmtSigned(r.totalReturnDollar)} (${fmtPct(r.totalReturnPct)})</td>
        `;
      } else {
        tr.innerHTML = `
          <td>${tickerCell}</td>
          <td>${r.company}</td>
          <td>${sectorBadge}</td>
          <td class="num cell-mono">${r.shares.toLocaleString()}</td>
          <td class="num cell-mono">${fmtUsd(r.costBasis)}</td>
          <td class="num cell-error" colspan="5">price unavailable — ${r.error || "live quote failed"}</td>
        `;
      }
      tbody.appendChild(tr);
    });
  }

  document.querySelectorAll("#holdingsTable thead th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "desc";
      }
      renderAll();
    });
  });

  // CSV export — built entirely from the same rows already rendered in the
  // table (live prices already fetched, nothing re-requested). Uses the
  // same field set as the table plus weight %, so the export matches what's
  // on screen at the moment of download.
  function downloadHoldingsCsv(rows, totals) {
    const sorted = sortRows(rows, totals.netWorth);
    const headers = [
      "Ticker", "Company", "Sector", "Risk Profile", "Beta", "Shares", "Cost Basis", "Live Price",
      "Market Value", "Weight %", "Day Change $", "Day Change %", "Total Return $", "Total Return %",
    ];
    const csvEscape = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    sorted.forEach((r) => {
      lines.push([
        r.ticker, r.company, r.sector,
        r.riskCategory || "",
        r.riskBeta != null ? r.riskBeta.toFixed(3) : "",
        r.shares,
        r.costBasis.toFixed(2),
        r.ok ? r.price.toFixed(2) : "",
        r.ok ? r.marketValue.toFixed(2) : "",
        r.ok ? r.weight.toFixed(2) : "",
        r.ok ? r.dayChangeDollar.toFixed(2) : "",
        r.ok ? r.dayChangePct.toFixed(2) : "",
        r.ok ? r.totalReturnDollar.toFixed(2) : "",
        r.ok ? r.totalReturnPct.toFixed(2) : "",
      ].map(csvEscape).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `northpoint-holdings-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.getElementById("exportCsvBtn").addEventListener("click", () => downloadHoldingsCsv(lastRows, lastTotals));

  /* ---------------------------------------------------------------------- */
  /* Rendering: stat strip + risk/concentration note                        */
  /* ---------------------------------------------------------------------- */

  // Pure client-side computation over rows already fetched for the table/KPIs
  // — no new API calls. Mirrors only what's already on screen.
  function renderStatStrip(rows) {
    const moverEl = document.getElementById("statTopMover");
    const laggardEl = document.getElementById("statTopLaggard");
    const upEl = document.getElementById("statUpCount");
    const priced = rows.filter((r) => r.ok && r.dayChangePct != null);

    if (priced.length === 0) {
      moverEl.textContent = "Top mover: unavailable";
      laggardEl.textContent = "Top laggard: unavailable";
      upEl.textContent = "Up today: unavailable";
      return;
    }

    const topMover = priced.reduce((a, b) => (b.dayChangePct > a.dayChangePct ? b : a));
    const topLaggard = priced.reduce((a, b) => (b.dayChangePct < a.dayChangePct ? b : a));
    const upCount = priced.filter((r) => r.dayChangeDollar > 0).length;

    moverEl.innerHTML = `Top mover: <strong class="${signClass(topMover.dayChangePct)}">${topMover.ticker} ${fmtPct(topMover.dayChangePct)}</strong>`;
    laggardEl.innerHTML = `Top laggard: <strong class="${signClass(topLaggard.dayChangePct)}">${topLaggard.ticker} ${fmtPct(topLaggard.dayChangePct)}</strong>`;
    upEl.innerHTML = `<strong>${upCount} of ${rows.length}</strong> holdings up today`;
  }

  // Factual/descriptive only — states concentration math, doesn't tell the
  // user what to do about it (that would cross into investment advice).
  // Lives as a 4th pill in the stat strip (condensed) rather than its own
  // banner card, so it sits in the empty space next to mover/laggard/breadth.
  function renderRiskNote(rows, totals) {
    const el = document.getElementById("statRiskNote");
    const okRows = rows.filter((r) => r.ok);
    if (okRows.length === 0 || !totals.netWorth) {
      el.innerHTML = "&nbsp;";
      return;
    }
    const withWeight = okRows
      .map((r) => ({ ...r, weight: (r.marketValue / totals.netWorth) * 100 }))
      .sort((a, b) => b.weight - a.weight);
    const topHolding = withWeight[0];
    const top3Weight = withWeight.slice(0, 3).reduce((s, r) => s + r.weight, 0);

    const sectorWeights = {};
    withWeight.forEach((r) => {
      sectorWeights[r.sector] = (sectorWeights[r.sector] || 0) + r.weight;
    });
    const topSectorEntry = Object.entries(sectorWeights).sort((a, b) => b[1] - a[1])[0];

    el.innerHTML =
      `Concentration risk: <strong class="risk-high">High</strong> — ${topHolding.ticker} ${topHolding.weight.toFixed(1)}%, ` +
      `top 3 ${top3Weight.toFixed(1)}%, ${topSectorEntry[0]} ${topSectorEntry[1].toFixed(1)}% of NW`;
    el.title =
      `${topHolding.ticker} is the largest single position at ${topHolding.weight.toFixed(1)}% of net worth, the top 3 holdings ` +
      `make up ${top3Weight.toFixed(1)}%, and ${topSectorEntry[0]} alone accounts for ${topSectorEntry[1].toFixed(1)}% of the book ` +
      `— with only ${rows.length} equity positions total, this fund carries more idiosyncratic, sector-specific risk than a ` +
      `broadly diversified index.`;
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering: sector donut                                                */
  /* ---------------------------------------------------------------------- */

  const SECTOR_COLORS = {
    Technology: "#5b8cff",
    "Communication Services": "#a78bfa",
    Financials: "#34d399",
    "Consumer Staples": "#fbbf24",
    Cash: "#5a6478",
  };

  // Risk Profile text colors — category comes from each holding's real beta
  // (Bigdata.com, see holdings-data.js), bucketed Defensive/Core/Growth-Risky.
  // Deliberately a separate palette from SECTOR_COLORS above (which the ticker
  // text now reuses) so Risk Profile never reads as a duplicate/confusable
  // color of the Sector column on the same row.
  const RISK_COLORS = {
    Defensive: "#38bdf8",
    Core: "#fb923c",
    "Growth/Risky": "#f43f5e",
  };
  // Distinct colors per individual holding for "Holding" allocation mode —
  // decorative palette, not brand colors (those are used on the ticker badges instead).
  const HOLDING_PALETTE = ["#5b8cff", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#f472b6"];

  let allocationMode = "sector";
  let donutCenterText = { value: "", label: "" };

  // Chart.js v4 has no built-in "text in the donut hole" feature — this is a
  // small custom plugin that draws the count (N Sectors / N Holdings) using
  // the chart's own actual chartArea, so it stays centered regardless of size.
  const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart) {
      if (!donutCenterText.value) return;
      const { ctx, chartArea } = chart;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      const inkColor = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#f4f6fb";
      const faintColor = getComputedStyle(document.documentElement).getPropertyValue("--ink-faint").trim() || "#8a93ad";
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 24px Inter, sans-serif";
      ctx.fillStyle = inkColor;
      ctx.fillText(donutCenterText.value, cx, cy - 11);
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillStyle = faintColor;
      ctx.fillText(donutCenterText.label, cx, cy + 12);
      ctx.restore();
    },
  };

  function drawDonut(labels, values, colors, tooltipLabelFn, centerText) {
    donutCenterText = centerText || { value: "", label: "" };
    const canvas = document.getElementById("sectorChart");
    const ctx = canvas.getContext("2d");
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
      options: {
        cutout: "68%",
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: tooltipLabelFn } } },
        animation: { duration: 250 },
      },
      plugins: [centerTextPlugin],
    });
  }

  function renderAllocationBySector(rows) {
    const bySector = {};
    rows.forEach((r) => {
      const val = r.ok ? r.marketValue : r.costBasis * r.shares; // fall back to cost basis so the donut still reconciles if a quote fails
      bySector[r.sector] = (bySector[r.sector] || 0) + val;
    });
    bySector["Cash"] = window.FUND.cashUsd;

    const total = Object.values(bySector).reduce((s, v) => s + v, 0);
    const labels = Object.keys(bySector);
    const values = Object.values(bySector);
    const colors = labels.map((l) => SECTOR_COLORS[l] || "#94a3b8");

    const sectorCount = new Set(rows.map((r) => r.sector)).size;
    drawDonut(labels, values, colors, (c) => `${c.label}: ${fmtUsd(c.raw)}`, {
      value: String(sectorCount),
      label: sectorCount === 1 ? "Sector" : "Sectors",
    });

    const legend = document.getElementById("sectorLegend");
    legend.innerHTML = labels
      .map(
        (l, i) => `<li><span class="swatch" style="background:${colors[i]}"></span><span class="legend-label">${l}</span><span class="legend-figures"><span class="legend-pct">${((values[i] / total) * 100).toFixed(1)}%</span><span class="legend-dollar">${fmtUsd(values[i], { maximumFractionDigits: 0 })}</span></span></li>`
      )
      .join("");
    document.getElementById("allocationSource").textContent = "source: holdings.json / universe.csv taxonomy";
  }

  function renderAllocationByHolding(rows) {
    const labels = [];
    const values = [];
    const colors = [];
    rows.forEach((r, i) => {
      const val = r.ok ? r.marketValue : r.costBasis * r.shares;
      labels.push(r.ticker);
      values.push(val);
      colors.push(HOLDING_PALETTE[i % HOLDING_PALETTE.length]);
    });
    labels.push("Cash");
    values.push(window.FUND.cashUsd);
    colors.push("#5a6478");

    const total = values.reduce((s, v) => s + v, 0);

    drawDonut(labels, values, colors, (c) => `${c.label}: ${fmtUsd(c.raw)}`, {
      value: String(rows.length),
      label: rows.length === 1 ? "Holding" : "Holdings",
    });

    const legend = document.getElementById("sectorLegend");
    legend.innerHTML = labels
      .map(
        (l, i) => `<li><span class="swatch" style="background:${colors[i]}"></span><span class="legend-label">${l}</span><span class="legend-figures"><span class="legend-pct">${((values[i] / total) * 100).toFixed(1)}%</span><span class="legend-dollar">${fmtUsd(values[i], { maximumFractionDigits: 0 })}</span></span></li>`
      )
      .join("");
    document.getElementById("allocationSource").textContent = "source: holdings.json (per-ticker market value)";
  }

  function renderSectorChart(rows) {
    if (allocationMode === "holding") {
      renderAllocationByHolding(rows);
    } else {
      renderAllocationBySector(rows);
    }
  }

  document.getElementById("allocationModeRow").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;
    document.querySelectorAll("#allocationModeRow .range-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    allocationMode = btn.dataset.mode;
    renderSectorChart(lastRows);
  });

  /* ---------------------------------------------------------------------- */
  /* Rendering: portfolio value chart (built from real Twelve Data history) */
  /* ---------------------------------------------------------------------- */

  let valueChartInstance = null;
  let valueChartFullDates = [];       // real-only: dates >= cost-basis date
  let valueChartFullSeries = [];
  let valueChartFullDatesAll = [];    // full fetched history, no inception cutoff (backtest input)
  let valueChartFullSeriesAll = [];
  let valueChartFailedTickers = [];
  let valueChartRange = "Max";

  // Trading-day counts used to slice the tail of the fetched history.
  // "Max"/"Since Inception" always means the REAL fund history only (never
  // before cost-basis date). 1M/1Y use the unfiltered "All" series, which
  // is a clearly-labeled HYPOTHETICAL backtest: real historical closes for
  // these exact 7 tickers x today's actual share counts, run backward before
  // the fund existed — useful for "what would this basket have done," but
  // never presented as the fund's actual track record. 1D is handled
  // separately below (real intraday hourly history, not a backtest).
  const VALUE_RANGE_DAYS = { "1M": 22, "1Y": 252, Max: Infinity };

  // ---- 1D intraday (hourly, real data — most recent trading session) ----
  let valueChart1DLabels = [];   // formatted "9:30 AM" style labels
  let valueChart1DSeries = [];
  let valueChart1DDate = null;
  let valueChart1DFailedTickers = [];
  let valueChart1DError = null;
  let valueChart1DLoaded = false;
  let valueChart1DLoadPromise = null;

  function formatTimeLabel(hhmm) {
    const [hStr, mStr] = hhmm.split(":");
    let h = parseInt(hStr, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${mStr} ${ampm}`;
  }

  // Fetches hourly closes for the most recent trading session for all 7
  // tickers and builds a portfolio-weighted intraday series. Fetched once
  // and cached client-side (same rationale as the daily history cache) —
  // re-fetched only on a full page reload, never invented if Twelve Data's
  // intraday data is unavailable.
  async function ensureIntraday1DLoaded() {
    if (valueChart1DLoaded) return;
    if (valueChart1DLoadPromise) return valueChart1DLoadPromise;
    valueChart1DLoadPromise = (async () => {
      try {
        // Intraday (1h) calls for all 7 tickers in a short burst were tripping
        // Twelve Data's free-tier per-minute request limit on every refresh —
        // that's why most tickers showed "unavailable" while the first one or
        // two usually succeeded. Spacing dispatch further apart and giving
        // retries more room/attempts keeps each call under that limit instead
        // of inventing a fallback price for the ones that got rate-limited.
        const histories = await Promise.all(
          TICKERS.map((t, i) => delay(i * 4000).then(() => fetchHistoryRetrying(t, 10, "1h", 4, 5000)))
        );
        const byTicker = {};
        histories.forEach((h, i) => (byTicker[TICKERS[i]] = h));

        const okTickers = TICKERS.filter((t) => byTicker[t] && byTicker[t].ok && byTicker[t].points && byTicker[t].points.length);
        valueChart1DFailedTickers = TICKERS.filter((t) => !okTickers.includes(t));

        if (okTickers.length === 0) {
          valueChart1DLabels = [];
          valueChart1DSeries = [];
          valueChart1DError = "Intraday history unavailable from Twelve Data right now — chart cannot be drawn.";
          return;
        }

        // Most recent trading date present across the ok tickers (handles being
        // viewed on a weekend/holiday — always shows the latest real session).
        const latestDate = okTickers.reduce((max, t) => {
          const pts = byTicker[t].points;
          const d = pts[pts.length - 1].date;
          return !max || d > max ? d : max;
        }, null);

        const dayPointsByTicker = {};
        okTickers.forEach((t) => {
          dayPointsByTicker[t] = byTicker[t].points.filter((p) => p.date === latestDate && p.time);
        });

        const timeSets = okTickers.map((t) => new Set(dayPointsByTicker[t].map((p) => p.time)));
        let commonTimes = timeSets.length ? [...timeSets[0]].filter((tm) => timeSets.every((s) => s.has(tm))) : [];
        commonTimes.sort();

        if (commonTimes.length === 0) {
          valueChart1DLabels = [];
          valueChart1DSeries = [];
          valueChart1DError = "No overlapping intraday timestamps returned across holdings for the most recent session.";
          return;
        }

        const series = commonTimes.map((tm) => {
          let total = window.FUND.cashUsd;
          window.HOLDINGS.forEach((h) => {
            if (okTickers.includes(h.ticker)) {
              const pt = dayPointsByTicker[h.ticker].find((p) => p.time === tm);
              total += (pt ? pt.close : h.costBasis) * h.shares; // missing single bar -> fall back to cost basis, never invent a price
            } else {
              total += h.costBasis * h.shares; // intraday fetch failed for this ticker -> fall back to cost basis
            }
          });
          return total;
        });

        valueChart1DLabels = commonTimes.map(formatTimeLabel);
        valueChart1DSeries = series;
        valueChart1DDate = latestDate;
        valueChart1DError = null;
      } catch (e) {
        valueChart1DError = `Could not load intraday history: ${e.message}`;
        valueChart1DLabels = [];
        valueChart1DSeries = [];
      } finally {
        valueChart1DLoaded = true;
        valueChart1DLoadPromise = null;
      }
    })();
    return valueChart1DLoadPromise;
  }

  function draw1DChart() {
    const note = document.getElementById("valueChartNote");
    const sourceTag = document.getElementById("valueChartSource");
    const ctx = document.getElementById("valueChart").getContext("2d");
    const existingValueChart = Chart.getChart(ctx.canvas);
    if (existingValueChart) existingValueChart.destroy();

    if (!valueChart1DLabels.length) {
      sourceTag.textContent = "source: Twelve Data (hourly close)";
      note.textContent = valueChart1DError || "Intraday history unavailable from Twelve Data right now.";
      return;
    }

    sourceTag.textContent = "source: Twelve Data (hourly close) · weighted by holdings.json shares";
    valueChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: valueChart1DLabels,
        datasets: [
          {
            data: valueChart1DSeries,
            borderColor: "#5b8cff",
            backgroundColor: hexToRgba("#5b8cff", 0.14),
            fill: true,
            tension: 0.25,
            pointRadius: valueChart1DLabels.length <= 4 ? 4 : 0,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmtUsd(c.raw) } },
        },
        scales: {
          x: { offset: false, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, font: { size: 11 } } },
          y: { ticks: { callback: (v) => fmtUsd(v, { maximumFractionDigits: 0 }) }, grid: { display: false } },
        },
        animation: { duration: 250 },
      },
    });

    let noteText = `Hourly close for ${valueChart1DDate} (most recent trading session) — ${valueChart1DLabels.length} bars, regular trading hours (9:30am–4:00pm ET).`;
    if (valueChart1DFailedTickers.length > 0) {
      noteText += ` ${valueChart1DFailedTickers.join(", ")} intraday history unavailable — chart reflects the remaining holdings only.`;
    }
    note.textContent = noteText;
  }

  async function renderValueChart(rows) {
    const note = document.getElementById("valueChartNote");
    try {
      // Fetch up to ~300 daily closes per ticker so the 1Y range has real data
      // behind it as the fund ages. (300 is a fixed ceiling, not a guarantee —
      // Twelve Data's free-tier history depth may cap this lower; verify in
      // their docs if "1Y"/"Max" ever look truncated.)
      // Requests are staggered ~150ms apart and retried once on failure since
      // firing all 7 close together can trip Twelve Data's free-tier
      // per-minute rate limit — spreading them ~900ms apart keeps the whole
      // batch comfortably under that ceiling even if other requests (e.g. a
      // modal chart open) land in the same window.
      const histories = await Promise.all(
        TICKERS.map((t, i) => delay(i * 900).then(() => fetchHistoryRetrying(t, 300)))
      );
      const byTicker = {};
      histories.forEach((h, i) => (byTicker[TICKERS[i]] = h));

      const failed = TICKERS.filter((t) => !byTicker[t] || !byTicker[t].ok);
      valueChartFailedTickers = failed;
      if (failed.length === TICKERS.length) {
        note.textContent = "Price history unavailable from Twelve Data right now — chart cannot be drawn.";
        valueChartFullDates = [];
        valueChartFullSeries = [];
        valueChartFullDatesAll = [];
        valueChartFullSeriesAll = [];
        return;
      }

      // Dates present for every successfully-fetched ticker (no inception cutoff here).
      const okTickers = TICKERS.filter((t) => byTicker[t] && byTicker[t].ok);
      const dateSets = okTickers.map((t) => new Set(byTicker[t].points.map((p) => p.date)));
      const costBasisDate = window.HOLDINGS[0].costBasisDate;
      let commonDatesAll = [...dateSets[0]].filter((d) => dateSets.every((s) => s.has(d)));
      commonDatesAll.sort();

      if (commonDatesAll.length === 0) {
        note.textContent = `No overlapping trading days returned across all holdings yet — the value history will build day by day from here.`;
        valueChartFullDates = [];
        valueChartFullSeries = [];
        valueChartFullDatesAll = [];
        valueChartFullSeriesAll = [];
        return;
      }

      const seriesAll = commonDatesAll.map((date) => {
        let total = window.FUND.cashUsd;
        window.HOLDINGS.forEach((h) => {
          const td = byTicker[h.ticker];
          if (td && td.ok) {
            const pt = td.points.find((p) => p.date === date);
            total += (pt ? pt.close : h.costBasis) * h.shares; // missing single date -> fall back to cost basis, never invent a price
          } else {
            total += h.costBasis * h.shares; // history fetch failed for this ticker -> fall back to cost basis, not a fabricated price
          }
        });
        return total;
      });

      valueChartFullDatesAll = commonDatesAll;
      valueChartFullSeriesAll = seriesAll;

      const realStartIdx = commonDatesAll.findIndex((d) => d >= costBasisDate);
      valueChartFullDates = realStartIdx === -1 ? [] : commonDatesAll.slice(realStartIdx);
      valueChartFullSeries = realStartIdx === -1 ? [] : seriesAll.slice(realStartIdx);

      updateValueRangeAvailability();
      drawValueChart(valueChartRange);
    } catch (e) {
      note.textContent = `Could not load portfolio history: ${e.message}`;
    }
  }

  function drawValueChart(range) {
    const note = document.getElementById("valueChartNote");
    const sourceTag = document.getElementById("valueChartSource");
    const isHypothetical = range !== "Max";
    const fullDates = isHypothetical ? valueChartFullDatesAll : valueChartFullDates;
    const fullSeries = isHypothetical ? valueChartFullSeriesAll : valueChartFullSeries;
    if (!fullDates.length) return;

    const maxDays = VALUE_RANGE_DAYS[range] !== undefined ? VALUE_RANGE_DAYS[range] : Infinity;
    const sliceStart = Math.max(0, fullDates.length - maxDays);
    const dates = fullDates.slice(sliceStart);
    const series = fullSeries.slice(sliceStart);
    const costBasisDate = window.HOLDINGS[0].costBasisDate;

    sourceTag.textContent = isHypothetical
      ? "source: Twelve Data (daily close) · hypothetical backtest of current shares"
      : "source: Twelve Data (daily close) · weighted by holdings.json shares";

    const lineColor = isHypothetical ? "#fbbf24" : "#5b8cff";
    const ctx = document.getElementById("valueChart").getContext("2d");
    const existingValueChart = Chart.getChart(ctx.canvas);
    if (existingValueChart) existingValueChart.destroy();
    valueChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: dates,
        datasets: [
          {
            data: series,
            borderColor: lineColor,
            backgroundColor: hexToRgba(lineColor, 0.14),
            borderDash: isHypothetical ? [6, 4] : [],
            fill: true,
            tension: 0.25,
            pointRadius: dates.length <= 4 ? 4 : 0,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => (isHypothetical ? "Hypothetical: " : "") + fmtUsd(c.raw) } },
        },
        scales: {
          x: { offset: false, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 11 } } },
          y: { ticks: { callback: (v) => fmtUsd(v, { maximumFractionDigits: 0 }) }, grid: { display: false } },
        },
        animation: { duration: 250 },
      },
    });

    if (isHypothetical) {
      note.textContent = `Hypothetical backtest — real historical closes for these 7 tickers, applied to today's actual share counts, run back before the fund existed. This is "what this basket would have been worth," not the fund's real performance (which only began ${costBasisDate}). See "Since Inception" for the real, actual fund history.`;
      return;
    }

    if (dates.length < 2) {
      note.textContent = `Only ${dates.length} trading day(s) of real history exist in this range since the ${costBasisDate} cost-basis date — a single point can't draw a trend line yet. The portfolio just started, this isn't a bug.`;
    } else if (valueChartFailedTickers.length > 0) {
      note.textContent = `${valueChartFailedTickers.join(", ")} history unavailable from Twelve Data — chart reflects the remaining holdings only.`;
    } else if (dates.length < 3) {
      note.textContent = `Only ${dates.length} trading day(s) of real history exist since the ${costBasisDate} cost-basis date — this chart will fill in as more days pass. No values before the cost-basis date are shown or invented.`;
    } else {
      note.textContent = "";
    }
  }

  // "Since Inception"/"Max" only ever shows real fund history, so it stays
  // locked until that many real post-inception trading days exist. 1M/1Y are
  // hypothetical backtests built from Twelve Data's full fetched history
  // (no inception cutoff), so they unlock based on raw history depth instead.
  function updateValueRangeAvailability() {
    const realDaysAvailable = valueChartFullDates.length;
    const allDaysAvailable = valueChartFullDatesAll.length;
    let activeBtnGotDisabled = false;
    document.querySelectorAll("#valueRangeRow .range-btn").forEach((btn) => {
      const range = btn.dataset.range;
      // 1D is real intraday history, fetched lazily on click — it isn't
      // gated by the daily-close history depth checked below, and its
      // tooltip must not say "hypothetical backtest" (that's 1M/1Y only).
      if (range === "1D") {
        btn.disabled = false;
        btn.title = "Real intraday hourly history for the most recent trading session (9:30am–4:00pm ET) — not a backtest.";
        return;
      }
      const needed = VALUE_RANGE_DAYS[range];
      const daysAvailable = range === "Max" ? realDaysAvailable : allDaysAvailable;
      const locked = needed !== Infinity && needed > 1 && daysAvailable < needed;
      btn.disabled = locked;
      btn.title = locked
        ? range === "Max"
          ? `Unlocks once ${needed} trading days of real history exist since the cost-basis date (currently ${daysAvailable}).`
          : `Unlocks once ${needed} trading days of price history are available from Twelve Data (currently ${daysAvailable}).`
        : range === "Max"
          ? ""
          : "Hypothetical backtest: real historical prices for these holdings x today's share counts, not the fund's actual track record.";
      if (locked && btn.classList.contains("active")) activeBtnGotDisabled = true;
    });
    if (activeBtnGotDisabled) {
      document.querySelectorAll("#valueRangeRow .range-btn").forEach((b) => b.classList.remove("active"));
      const maxBtn = document.querySelector('#valueRangeRow .range-btn[data-range="Max"]');
      if (maxBtn) maxBtn.classList.add("active");
      valueChartRange = "Max";
    }
  }

  document.getElementById("valueRangeRow").addEventListener("click", async (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn || btn.disabled) return;
    document.querySelectorAll("#valueRangeRow .range-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    valueChartRange = btn.dataset.range;
    if (valueChartRange === "1D") {
      // Real intraday hourly history (most recent session) — separate code
      // path from drawValueChart, which only ever handles daily-close data.
      const note = document.getElementById("valueChartNote");
      note.textContent = "Loading intraday history…";
      await ensureIntraday1DLoaded();
      draw1DChart();
    } else {
      drawValueChart(valueChartRange);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Modal                                                                  */
  /* ---------------------------------------------------------------------- */

  let modalChartInstance = null;
  let modalCurrentTicker = null;
  let modalRange = "1M";

  // Outputsize (trading days) requested from Twelve Data per range. "Max" is
  // a generous fixed ceiling, not a guarantee of how far back Twelve Data's
  // plan actually has data — verify their docs if "Max" looks capped.
  const MODAL_RANGE_OUTPUTSIZE = { "1M": 22, "3M": 65, "6M": 130, "1Y": 260, Max: 5000 };

  function formatChartDate(iso) {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  async function renderModalChart(ticker, range) {
    const chartErrEl = document.getElementById("modalChartError");
    chartErrEl.textContent = "";
    try {
      const outputsize = MODAL_RANGE_OUTPUTSIZE[range] || 22;
      const hist = await fetchHistoryRetrying(ticker, outputsize);
      const modalCanvas = document.getElementById("modalChart");
      const existingModalChart = Chart.getChart(modalCanvas);
      if (!hist.ok || !hist.points || hist.points.length === 0) {
        chartErrEl.textContent = `Price history unavailable: ${hist.error || "no data returned"}`;
        if (existingModalChart) existingModalChart.destroy();
        modalChartInstance = null;
        return;
      }
      const labels = hist.points.map((p) => formatChartDate(p.date));
      const closes = hist.points.map((p) => p.close);
      const ctx = modalCanvas.getContext("2d");
      if (existingModalChart) existingModalChart.destroy();
      modalChartInstance = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data: closes,
              borderColor: "#fb7185",
              backgroundColor: "rgba(251,113,133,0.14)",
              fill: true,
              tension: 0.25,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtUsd(c.raw) } } },
          scales: {
            x: { offset: false, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 12 } } },
            y: { grid: { display: false }, ticks: { callback: (v) => fmtUsd(v, { maximumFractionDigits: 0 }), font: { size: 12 } } },
          },
          animation: { duration: 200 },
        },
      });

      if (hist.points.length < outputsize * 0.6) {
        chartErrEl.textContent = `Showing ${hist.points.length} real trading day(s) — Twelve Data returned fewer than the ${range} range normally covers (plan limit or short listing history). Nothing is invented to fill the gap.`;
      }
    } catch (e) {
      chartErrEl.textContent = `Price history unavailable: ${e.message}`;
    }
  }

  document.getElementById("modalRangeRow").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn || !modalCurrentTicker) return;
    document.querySelectorAll("#modalRangeRow .range-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    modalRange = btn.dataset.range;
    renderModalChart(modalCurrentTicker, modalRange);
  });

  async function openModal(ticker) {
    const h = window.HOLDINGS.find((x) => x.ticker === ticker);
    const q = state.quotes[ticker];
    const overlay = document.getElementById("modalOverlay");
    overlay.classList.add("open");

    const brand = readableBrand(BRAND_COLORS[h.ticker]);
    const tickerEl = document.getElementById("modalTicker");
    tickerEl.textContent = h.ticker;
    tickerEl.style.color = brand;
    const logoEl = document.getElementById("modalLogo");
    const logoUrl = logoUrlFor(h.bigdata && h.bigdata.website);
    if (logoUrl) {
      logoEl.src = logoUrl;
      logoEl.onerror = () => { logoEl.style.display = "none"; };
      logoEl.style.display = "";
    } else {
      logoEl.removeAttribute("src");
      logoEl.style.display = "none";
    }
    document.getElementById("modalCompany").textContent = h.company;
    document.getElementById("modalIndustry").textContent = h.bigdata.industry || "not available";
    document.getElementById("modalExchange").textContent = h.bigdata.exchange || "not available";

    const priceEl = document.getElementById("modalPrice");
    const returnEl = document.getElementById("modalReturn");
    const quoteSourceEl = document.getElementById("modalQuoteSource");

    if (q && q.ok) {
      priceEl.textContent = fmtUsd(q.price);
      const totalReturn = (q.price - h.costBasis) * h.shares;
      const totalReturnPct = ((q.price - h.costBasis) / h.costBasis) * 100;
      returnEl.textContent = `${fmtSigned(totalReturn)} (${fmtPct(totalReturnPct)})`;
      returnEl.className = `modal-return ${signClass(totalReturn)}`;
      document.getElementById("modalDayRange").textContent = q.low != null && q.high != null ? `${fmtUsd(q.low)} – ${fmtUsd(q.high)}` : "not available";
      document.getElementById("modalOpen").textContent = q.open != null ? fmtUsd(q.open) : "not available";
      document.getElementById("modalPrevClose").textContent = q.previousClose != null ? fmtUsd(q.previousClose) : "not available";
      document.getElementById("modalPositionValue").textContent = fmtUsd(q.price * h.shares);
      quoteSourceEl.textContent = `price source: ${q.source || "unknown"} · as of ${state.lastSyncUtc ? new Date(state.lastSyncUtc).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "—"}`;
    } else {
      priceEl.textContent = "unavailable";
      returnEl.textContent = "—";
      returnEl.className = "modal-return";
      document.getElementById("modalDayRange").textContent = "not available";
      document.getElementById("modalOpen").textContent = "not available";
      document.getElementById("modalPrevClose").textContent = "not available";
      document.getElementById("modalPositionValue").textContent = "not available";
      quoteSourceEl.textContent = `live quote failed: ${q && q.error ? q.error : "unknown error"}`;
    }

    document.getElementById("modalShares").textContent = h.shares.toLocaleString();
    document.getElementById("modalCostBasis").textContent = fmtUsd(h.costBasis);
    document.getElementById("modalCostBasisAsOf").textContent = `cost basis as of ${h.costBasisDate} · source: holdings.json`;

    // Risk Profile lives here (instead of its own table column) — category is a
    // transparent bucketing of the real beta pulled from Bigdata.com, never guessed.
    const riskProfileEl = document.getElementById("modalRiskProfile");
    const riskSourceEl = document.getElementById("modalRiskSource");
    if (h.risk) {
      riskProfileEl.textContent = `${h.risk.category} (beta ${h.risk.beta.toFixed(2)})`;
      riskProfileEl.style.color = RISK_COLORS[h.risk.category] || "var(--ink)";
      riskSourceEl.textContent = `risk profile: beta-based category · source: Bigdata.com company tearsheet, as of ${h.risk.asOfUtc}`;
    } else {
      riskProfileEl.textContent = "not available";
      riskProfileEl.style.color = "";
      riskSourceEl.textContent = "risk profile not available";
    }

    document.getElementById("modalProfileDesc").textContent = h.bigdata.description || "Company description not available.";
    const websiteEl = document.getElementById("modalProfileWebsite");
    if (h.bigdata.website) {
      websiteEl.href = h.bigdata.website;
      websiteEl.textContent = h.bigdata.website.replace(/^https?:\/\//, "");
    } else {
      websiteEl.removeAttribute("href");
      websiteEl.textContent = "not available";
    }
    document.getElementById("modalProfileSource").textContent = `source: Bigdata.com snapshot, ${h.bigdata.asOfUtc}`;

    // Price history chart — reset to the default 1M range each time a new ticker's modal opens.
    modalCurrentTicker = ticker;
    modalRange = "1M";
    document.querySelectorAll("#modalRangeRow .range-btn").forEach((b) => b.classList.toggle("active", b.dataset.range === "1M"));
    await renderModalChart(ticker, modalRange);
  }

  function closeModal() {
    document.getElementById("modalOverlay").classList.remove("open");
  }

  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  document.getElementById("holdingsTbody").addEventListener("click", (e) => {
    const btn = e.target.closest(".ticker-btn");
    if (btn) openModal(btn.dataset.ticker);
  });

  /* ---------------------------------------------------------------------- */
  /* Refresh / orchestration                                               */
  /* ---------------------------------------------------------------------- */

  let lastRows = computeRows();
  let lastTotals = computeTotals(lastRows);

  function renderAll() {
    lastRows = computeRows();
    lastTotals = computeTotals(lastRows);
    renderKpis(lastRows, lastTotals);
    renderStatStrip(lastRows);
    renderRiskNote(lastRows, lastTotals);
    renderTable(lastRows, lastTotals);
    renderSectorChart(lastRows, lastTotals);
  }

  async function refresh() {
    const btn = document.getElementById("refreshBtn");
    btn.disabled = true;
    btn.querySelector("svg").classList.add("spin");
    try {
      const data = await fetchQuotes();
      state.quotes = {};
      (data.quotes || []).forEach((q) => (state.quotes[q.ticker] = q));
      state.lastSyncUtc = data.asOfUtc || new Date().toISOString();
      document.getElementById("lastSync").textContent =
        new Date(state.lastSyncUtc).toLocaleTimeString("en-US", { timeZone: "America/New_York" }) + " ET";
      renderAll();
    } catch (e) {
      document.getElementById("lastSync").textContent = `failed (${e.message})`;
    } finally {
      btn.disabled = false;
      btn.querySelector("svg").classList.remove("spin");
    }
  }

  document.getElementById("refreshBtn").addEventListener("click", refresh);

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  updateClock();
  setInterval(updateClock, 1000);
  renderAll(); // render structure immediately with "—" placeholders, no stale numbers
  refresh();   // then pull live quotes
  renderValueChart(lastRows);
})();
