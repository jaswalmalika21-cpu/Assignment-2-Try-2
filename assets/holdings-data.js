/* ==========================================================================
   NORTHPOINT GROWTH FUND — HOLDINGS DATA
   ==========================================================================
   This is the ONE place that defines the portfolio. Everything else in the
   app (KPIs, table, charts, modal) is derived from this file at runtime.

   Source of truth: holdings.json (chat 2, finalized picks). Do not add,
   drop, or re-size positions here — this file mirrors holdings.json exactly.

   "bigdata" blocks below are a SNAPSHOT pulled live from the Bigdata.com
   MCP connector on 2026-06-24 (the same session that produced holdings.json).
   Bigdata.com does not expose a public REST endpoint this static site can
   call after deployment, so profile/description/website/industry/exchange
   are baked in here as a dated snapshot rather than fetched live. Live
   PRICE and live PRICE HISTORY are fetched on every page load / refresh via
   Netlify functions backed by Finnhub and Twelve Data (see netlify/functions).
   Every value rendered in the UI carries a source tag so nothing baked-in
   is ever shown as if it were live.

   "risk" blocks below hold each holding's BETA — a real, sourced volatility
   metric (price sensitivity vs. the market) pulled live from the Bigdata.com
   company tearsheet (company_overview.beta) on 2026-06-27. This is a later,
   separate pull from the 2026-06-24 "bigdata" snapshot above — note the
   different as-of date. No risk score here is guessed; "category" is a
   transparent bucketing of that real beta value using fixed thresholds:
     beta < 0.90        -> "Defensive"   (less volatile than the market)
     0.90 <= beta <= 1.30 -> "Core"        (close to market volatility)
     beta > 1.30         -> "Growth/Risky" (notably more volatile than the market)
   ========================================================================== */

const FUND = {
  name: "Northpoint Growth Fund",
  startingCapitalUsd: 1000000.00,
  cashUsd: 55539.52,
  cashPct: 5.55,
  asOf: "2026-06-26",
};

const HOLDINGS = [
  {
    ticker: "MSFT",
    company: "Microsoft Corp.",
    sector: "Technology", // fund/universe.csv taxonomy — keeps donut consistent with the mandate's sector count
    shares: 574,
    costBasis: 372.97,
    costBasisDate: "2026-06-26",
    risk: { beta: 1.103, category: "Core", asOfUtc: "2026-06-27T04:46:50Z" },
    bigdata: {
      asOfUtc: "2026-06-24T20:00:03Z",
      sectorBigdata: "Technology",
      industry: "Software - Infrastructure",
      exchange: "NASDAQ",
      website: "https://www.microsoft.com",
      description:
        "Microsoft Corporation is a prominent global technology firm that invents, markets, and provides ongoing assistance for a diverse range of software, digital services, computing devices, and comprehensive solutions, organized into Productivity and Business Processes, Intelligent Cloud, and More Personal Computing segments. Founded in 1975, the company is headquartered in Redmond, Washington.",
    },
  },
  {
    ticker: "GOOGL",
    company: "Alphabet Inc.",
    sector: "Communication Services",
    shares: 492,
    costBasis: 337.39,
    costBasisDate: "2026-06-26",
    risk: { beta: 1.237, category: "Core", asOfUtc: "2026-06-27T04:46:51Z" },
    bigdata: {
      asOfUtc: "2026-06-24T20:00:02Z",
      sectorBigdata: "Communication Services",
      industry: "Internet Content & Information",
      exchange: "NASDAQ",
      website: "https://www.abc.xyz",
      description:
        "Alphabet Inc. provides a diverse range of products and digital platforms to consumers globally through Google Services (Search, YouTube, Android, Chrome), Google Cloud, and Other Bets. Established in 1998, Alphabet is headquartered in Mountain View, California.",
    },
  },
  {
    ticker: "V",
    company: "Visa Inc.",
    sector: "Financials",
    shares: 511,
    costBasis: 336.23,
    costBasisDate: "2026-06-26",
    risk: { beta: 0.765, category: "Defensive", asOfUtc: "2026-06-27T04:46:52Z" },
    bigdata: {
      asOfUtc: "2026-06-24T20:00:03Z",
      sectorBigdata: "Financial Services",
      industry: "Financial - Credit Services",
      exchange: "NYSE",
      website: "https://www.visa.com",
      description:
        "Visa Inc. operates globally as a payments technology company, enabling secure digital transfer of funds between consumers, businesses, banks, and governments via VisaNet, its core transaction processing network. Founded in 1958, Visa is headquartered in San Francisco, California.",
    },
  },
  {
    ticker: "JPM",
    company: "JPMorgan Chase & Co.",
    sector: "Financials",
    shares: 479,
    costBasis: 329.05,
    costBasisDate: "2026-06-26",
    risk: { beta: 1.0, category: "Core", asOfUtc: "2026-06-27T04:46:53Z" },
    bigdata: {
      asOfUtc: "2026-06-24T20:00:02Z",
      sectorBigdata: "Financial Services",
      industry: "Banks - Diversified",
      exchange: "NYSE",
      website: "http://www.jpmorganchase.com",
      description:
        "JPMorgan Chase & Co. is a bank and financial holding company operating through Consumer & Community Banking, Commercial & Investment Bank, and Asset & Wealth Management segments. Founded in 1799, it is headquartered in New York, New York.",
    },
  },
  {
    ticker: "COST",
    company: "Costco Wholesale Corp.",
    sector: "Consumer Staples",
    shares: 156,
    costBasis: 952.54,
    costBasisDate: "2026-06-26",
    risk: { beta: 0.868, category: "Defensive", asOfUtc: "2026-06-27T04:46:54Z" },
    bigdata: {
      asOfUtc: "2026-06-24T20:00:02Z",
      sectorBigdata: "Consumer Defensive", // bigdata's taxonomy label for this sector differs from universe.csv's "Consumer Staples" — same bucket, different naming. See reflection.
      industry: "Discount Stores",
      exchange: "NASDAQ",
      website: "https://www.costco.com",
      description:
        "Costco Wholesale Corporation operates membership-based retail warehouses internationally, offering branded and private-label merchandise across groceries, electronics, appliances, and more. Founded in 1976, Costco is headquartered in Issaquah, Washington.",
    },
  },
  {
    ticker: "NVDA",
    company: "NVIDIA Corp.",
    sector: "Technology",
    shares: 276,
    costBasis: 192.53,
    costBasisDate: "2026-06-26",
    risk: { beta: 2.202, category: "Growth/Risky", asOfUtc: "2026-06-27T04:46:55Z" },
    bigdata: {
      asOfUtc: "2026-06-24T20:00:03Z",
      sectorBigdata: "Technology",
      industry: "Semiconductors",
      exchange: "NASDAQ",
      website: "https://www.nvidia.com",
      description:
        "NVIDIA Corporation provides graphics, computing, and networking solutions through Graphics and Compute & Networking segments, central to AI, gaming, data center, and automotive applications. Founded in 1993, NVIDIA is headquartered in Santa Clara, California.",
    },
  },
  {
    ticker: "AVGO",
    company: "Broadcom Inc.",
    sector: "Technology",
    shares: 91,
    costBasis: 365.02,
    costBasisDate: "2026-06-26",
    risk: { beta: 1.433, category: "Growth/Risky", asOfUtc: "2026-06-27T04:46:56Z" },
    bigdata: {
      asOfUtc: "2026-06-24T20:00:02Z",
      sectorBigdata: "Technology",
      industry: "Semiconductors",
      exchange: "NASDAQ",
      website: "https://www.broadcom.com",
      description:
        "Broadcom Inc. designs, develops, and supplies semiconductor and infrastructure software solutions across Wired Infrastructure, Wireless Communications, Enterprise Storage, and Industrial segments. Headquartered in San Jose, California.",
    },
  },
];

// Exposed for app.js (no module bundler — plain globals by design, kept dependency-free for a static Netlify deploy)
window.FUND = FUND;
window.HOLDINGS = HOLDINGS;
