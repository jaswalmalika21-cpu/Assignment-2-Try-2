/* Netlify serverless function — live quote proxy.
 * Priority: Finnhub (primary live-quote source per assignment spec),
 * falling back to Twelve Data per-ticker if Finnhub fails for that symbol.
 * API keys are read from Netlify environment variables (FINNHUB_API_KEY,
 * TWELVEDATA_API_KEY) and never sent to the browser — only the resulting
 * quote JSON is.
 */

const FINNHUB_URL = "https://finnhub.io/api/v1/quote";
const TWELVEDATA_URL = "https://api.twelvedata.com/quote";

async function fetchFinnhub(ticker, apiKey) {
  const url = `${FINNHUB_URL}?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const data = await res.json();
  if (data.c === null || data.c === undefined || data.c === 0) {
    throw new Error("Finnhub returned no usable price");
  }
  return {
    ticker,
    ok: true,
    source: "finnhub",
    price: data.c,
    change: data.d,
    percentChange: data.dp,
    previousClose: data.pc,
    open: data.o,
    high: data.h,
    low: data.l,
  };
}

async function fetchTwelveData(ticker, apiKey) {
  const url = `${TWELVEDATA_URL}?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === "error" || data.close === undefined || data.close === null) {
    throw new Error(data.message || "Twelve Data returned no usable price");
  }
  return {
    ticker,
    ok: true,
    source: "twelvedata",
    price: parseFloat(data.close),
    change: data.change !== undefined ? parseFloat(data.change) : null,
    percentChange: data.percent_change !== undefined ? parseFloat(data.percent_change) : null,
    previousClose: data.previous_close !== undefined ? parseFloat(data.previous_close) : null,
    open: data.open !== undefined ? parseFloat(data.open) : null,
    high: data.high !== undefined ? parseFloat(data.high) : null,
    low: data.low !== undefined ? parseFloat(data.low) : null,
  };
}

exports.handler = async (event) => {
  const tickersParam = (event.queryStringParameters && event.queryStringParameters.tickers) || "";
  const tickers = tickersParam.split(",").map((t) => t.trim()).filter(Boolean);

  if (tickers.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "missing tickers query param" }) };
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const twelveDataKey = process.env.TWELVEDATA_API_KEY;

  const quotes = await Promise.all(
    tickers.map(async (ticker) => {
      if (finnhubKey) {
        try {
          return await fetchFinnhub(ticker, finnhubKey);
        } catch (finnhubErr) {
          if (twelveDataKey) {
            try {
              return await fetchTwelveData(ticker, twelveDataKey);
            } catch (tdErr) {
              return { ticker, ok: false, error: `finnhub: ${finnhubErr.message}; twelvedata fallback: ${tdErr.message}` };
            }
          }
          return { ticker, ok: false, error: `finnhub: ${finnhubErr.message}; no Twelve Data key configured for fallback` };
        }
      } else if (twelveDataKey) {
        try {
          return await fetchTwelveData(ticker, twelveDataKey);
        } catch (tdErr) {
          return { ticker, ok: false, error: `twelvedata: ${tdErr.message}` };
        }
      } else {
        return { ticker, ok: false, error: "no FINNHUB_API_KEY or TWELVEDATA_API_KEY configured" };
      }
    })
  );

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ asOfUtc: new Date().toISOString(), quotes }),
  };
};
