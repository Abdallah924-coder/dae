const assets = require('../config/cryptoAssets');

let cachedPrices;
let cachedAt = 0;
const CACHE_MS = 60_000;

async function getMarketPrices() {
  if (cachedPrices && Date.now() - cachedAt < CACHE_MS) {
    return { updatedAt: new Date(cachedAt), markets: cachedPrices };
  }

  const ids = assets.map((asset) => asset.coinGeckoId).join(',');
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
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
  return { updatedAt: new Date(cachedAt), markets };
}

module.exports = { getMarketPrices };
