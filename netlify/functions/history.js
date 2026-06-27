/* Netlify serverless function — price-history proxy (Twelve Data).
 * Used for the per-ticker modal chart, the portfolio value chart (daily),
 * and the 1D intraday chart (hourly). Twelve Data's free tier only covers
 * price/time-series, never fundamentals — this function never returns
 * anything but date/close (and, for intraday intervals, time) pairs.
 */

const TIME_SERIES_URL = "https://api.twelvedata.com/time_series";

exports.handler = async (event) => {
  const ticker = event.queryStringParameters && event.queryStringParameters.ticker;
  const outputsize = (event.queryStringParameters && event.queryStringParameters.outputsize) || "30";
  const interval = (event.queryStringParameters && event.queryStringParameters.interval) || "1day";
  const isIntraday = interval !== "1day";

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
    // Intraday intervals need an explicit timezone or Twelve Data returns
    // timestamps without a consistent, usable offset for grouping bars by
    // hour — America/New_York keeps bars aligned to the 9:30am-4:00pm ET
    // regular session regardless of where this function happens to run.
    let url = `${TIME_SERIES_URL}?symbol=${encodeURIComponent(ticker)}&interval=${encodeURIComponent(interval)}&outputsize=${encodeURIComponent(outputsize)}&apikey=${apiKey}`;
    if (isIntraday) url += `&timezone=America/New_York`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === "error" || !Array.isArray(data.values)) {
      throw new Error(data.message || "Twelve Data returned no time series");
    }

    const points = data.values
      .map((v) => ({
        date: v.datetime.slice(0, 10),
        time: isIntraday ? v.datetime.slice(11, 16) : undefined,
        close: parseFloat(v.close),
      }))
      .filter((p) => !Number.isNaN(p.close))
      .sort((a, b) => {
        const aKey = `${a.date} ${a.time || "00:00"}`;
        const bKey = `${b.date} ${b.time || "00:00"}`;
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });

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
