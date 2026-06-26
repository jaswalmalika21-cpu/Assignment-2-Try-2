/* Netlify serverless function — daily price-history proxy (Twelve Data).
 * Used for both the per-ticker modal chart and the portfolio value chart.
 * Twelve Data's free tier only covers price/time-series, never fundamentals
 * — this function never returns anything but date/close pairs.
 */

const TIME_SERIES_URL = "https://api.twelvedata.com/time_series";

exports.handler = async (event) => {
  const ticker = event.queryStringParameters && event.queryStringParameters.ticker;
  const outputsize = (event.queryStringParameters && event.queryStringParameters.outputsize) || "30";

  if (!ticker) {
    return { statusCode: 400, body: JSON.stringify({ error: "missing ticker query param" }) };
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ticker, ok: false, source: "twelvedata", error: "no TWELVEDATA_API_KEY configured" }),
    };
  }

  try {
    const url = `${TIME_SERIES_URL}?symbol=${encodeURIComponent(ticker)}&interval=1day&outputsize=${encodeURIComponent(outputsize)}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === "error" || !Array.isArray(data.values)) {
      throw new Error(data.message || "Twelve Data returned no time series");
    }

    const points = data.values
      .map((v) => ({ date: v.datetime.slice(0, 10), close: parseFloat(v.close) }))
      .filter((p) => !Number.isNaN(p.close))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ticker, ok: true, source: "twelvedata", points }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ticker, ok: false, source: "twelvedata", error: e.message }),
    };
  }
};
