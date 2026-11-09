'use strict';

const tradableAssets = require('./cryptoAssets');

const marketOnlyAssets = [
  { id: 'BNB', name: 'BNB', coinGeckoId: 'binancecoin', coinPaprikaId: 'bnb-binance-coin' },
  { id: 'XRP', name: 'XRP', coinGeckoId: 'ripple', coinPaprikaId: 'xrp-xrp' },
  { id: 'ADA', name: 'Cardano', coinGeckoId: 'cardano', coinPaprikaId: 'ada-cardano' },
  { id: 'DOGE', name: 'Dogecoin', coinGeckoId: 'dogecoin', coinPaprikaId: 'doge-dogecoin' },
  { id: 'TRX', name: 'TRON', coinGeckoId: 'tron', coinPaprikaId: 'trx-tron' },
  { id: 'LTC', name: 'Litecoin', coinGeckoId: 'litecoin', coinPaprikaId: 'ltc-litecoin' },
  { id: 'AVAX', name: 'Avalanche', coinGeckoId: 'avalanche-2', coinPaprikaId: 'avax-avalanche' },
  { id: 'LINK', name: 'Chainlink', coinGeckoId: 'chainlink', coinPaprikaId: 'link-chainlink' },
  { id: 'DOT', name: 'Polkadot', coinGeckoId: 'polkadot', coinPaprikaId: 'dot-polkadot' },
].map((asset) => ({ ...asset, networks: [], tradeEnabled: false }));

module.exports = [
  ...tradableAssets.map((asset) => ({ ...asset, tradeEnabled: true })),
  ...marketOnlyAssets,
];
