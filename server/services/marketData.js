const assets = require('../config/cryptoAssets');

let cachedPrices;
let cachedAt = 0;
let pendingRequest;
let retryAfter = 0;
let lastFetchError;
const CACHE_MS = 5 * 60_000;
const MAX_STALE_MS = 30 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;

async function fetchMarketPrices() {
  const ids = assets.map((asset) => asset.coinGeckoId).join(',');
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`,
    {
      headers: {
        accept: 'application/json',
        ...(apiKey ? { 'x-cg-demo-api-key': apiKey } : {}),
      },
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

  cachedPrices = markets;
  cachedAt = Date.now();
  retryAfter = 0;
  lastFetchError = undefined;
  return { updatedAt: new Date(cachedAt), markets, stale: false };
}

async function getMarketPrices({ allowStale = true } = {}) {
  if (cachedPrices && Date.now() - cachedAt < CACHE_MS) {
    return { updatedAt: new Date(cachedAt), markets: cachedPrices, stale: false };
  }

  if (!pendingRequest && Date.now() < retryAfter) {
    if (allowStale && cachedPrices && Date.now() - cachedAt < MAX_STALE_MS) {
      return { updatedAt: new Date(cachedAt), markets: cachedPrices, stale: true };
    }
    throw lastFetchError || new Error('Actualisation CoinGecko temporairement limitée');
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
      return { updatedAt: new Date(cachedAt), markets: cachedPrices, stale: true };
    }
    throw error;
  }
}

module.exports = { getMarketPrices };
