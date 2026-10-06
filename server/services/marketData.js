const assets = require('../config/cryptoAssets');

let cachedPrices;
let cachedAt = 0;
let cachedSource;
let pendingRequest;
let retryAfter = 0;
let lastFetchError;
const CACHE_MS = 5 * 60_000;
const MAX_STALE_MS = 30 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;

async function fetchCoinPaprikaPrices() {
  const response = await fetch(
    'https://api.coinpaprika.com/v1/tickers?quotes=USD',
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) }
  );
  if (!response.ok) throw new Error(`CoinPaprika a répondu avec le statut ${response.status}`);
  const tickers = await response.json();
  if (!Array.isArray(tickers)) throw new Error('Réponse CoinPaprika invalide');

  const byId = new Map(tickers.map((ticker) => [ticker.id, ticker]));
  const markets = assets.map((asset) => {
    const quote = byId.get(asset.coinPaprikaId)?.quotes?.USD;
    return {
      asset: asset.id,
      name: asset.name,
      priceUsd: quote?.price ?? null,
      change24h: quote?.percent_change_24h ?? null,
    };
  });
  if (markets.some((market) => !Number.isFinite(market.priceUsd) || market.priceUsd <= 0)) {
    throw new Error('CoinPaprika n’a pas fourni tous les cours demandés en USD');
  }
  return markets;
}

async function fetchCoinGeckoPrices() {
  const ids = assets.map((asset) => asset.coinGeckoId).join(',');
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!response.ok) throw new Error(`CoinGecko a répondu avec le statut ${response.status}`);
  const data = await response.json();
  const markets = assets.map((asset) => ({
    asset: asset.id,
    name: asset.name,
    priceUsd: data[asset.coinGeckoId]?.usd ?? null,
    change24h: data[asset.coinGeckoId]?.usd_24h_change ?? null,
  }));
  if (markets.some((market) => !Number.isFinite(market.priceUsd) || market.priceUsd <= 0)) {
    throw new Error('CoinGecko n’a pas fourni tous les cours demandés en USD');
  }
  return markets;
}

async function fetchMarketPrices() {
  let markets;
  let source;
  try {
    markets = await fetchCoinPaprikaPrices();
    source = 'CoinPaprika';
  } catch (paprikaError) {
    console.warn(`CoinPaprika indisponible, essai de secours CoinGecko : ${paprikaError.message}`);
    try {
      markets = await fetchCoinGeckoPrices();
      source = 'CoinGecko';
    } catch (geckoError) {
      throw new Error(`Sources de cours indisponibles (CoinPaprika : ${paprikaError.message}; CoinGecko : ${geckoError.message})`);
    }
  }

  cachedPrices = markets;
  cachedSource = source;
  cachedAt = Date.now();
  retryAfter = 0;
  lastFetchError = undefined;
  return { updatedAt: new Date(cachedAt), markets, source, stale: false };
}

async function getMarketPrices({ allowStale = true } = {}) {
  if (cachedPrices && Date.now() - cachedAt < CACHE_MS) {
    return { updatedAt: new Date(cachedAt), markets: cachedPrices, source: cachedSource, stale: false };
  }

  if (!pendingRequest && Date.now() < retryAfter) {
    if (allowStale && cachedPrices && Date.now() - cachedAt < MAX_STALE_MS) {
      return { updatedAt: new Date(cachedAt), markets: cachedPrices, source: cachedSource, stale: true };
    }
    throw lastFetchError || new Error('Actualisation des cours temporairement limitée');
  }

  if (!pendingRequest) {
    pendingRequest = fetchMarketPrices()
      .catch((error) => {
        lastFetchError = error;
        retryAfter = Date.now() + RETRY_DELAY_MS;
        throw error;
      })
      .finally(() => {
        pendingRequest = undefined;
      });
  }

  try {
    return await pendingRequest;
  } catch (error) {
    if (allowStale && cachedPrices && Date.now() - cachedAt < MAX_STALE_MS) {
      return { updatedAt: new Date(cachedAt), markets: cachedPrices, source: cachedSource, stale: true };
    }
    throw error;
  }
}

module.exports = { getMarketPrices };
