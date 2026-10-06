module.exports = [
  {
    id: 'USDT',
    name: 'Tether',
    coinGeckoId: 'tether',
    coinPaprikaId: 'usdt-tether',
    networks: [
      { id: 'TRC20', name: 'Tron (TRC20)' },
      { id: 'BEP20', name: 'BNB Smart Chain (BEP20)' },
      { id: 'ERC20', name: 'Ethereum (ERC20)' },
    ],
  },
  {
    id: 'BTC',
    name: 'Bitcoin',
    coinGeckoId: 'bitcoin',
    coinPaprikaId: 'btc-bitcoin',
    networks: [
      { id: 'BITCOIN', name: 'Bitcoin (natif)' },
      { id: 'LIGHTNING', name: 'Lightning Network' },
      { id: 'BEP20', name: 'BNB Smart Chain (BTC envelopé)' },
    ],
  },
  {
    id: 'POL',
    name: 'Polygon Ecosystem Token',
    coinGeckoId: 'polygon-ecosystem-token',
    coinPaprikaId: 'pol-polygon-ecosystem-token',
    networks: [
      { id: 'POLYGON', name: 'Polygon (natif)' },
      { id: 'ERC20', name: 'Ethereum (POL envelopé)' },
      { id: 'BEP20', name: 'BNB Smart Chain (POL envelopé)' },
    ],
  },
  {
    id: 'ETH',
    name: 'Ethereum',
    coinGeckoId: 'ethereum',
    coinPaprikaId: 'eth-ethereum',
    networks: [
      { id: 'ETHEREUM', name: 'Ethereum (natif)' },
      { id: 'ARBITRUM', name: 'Arbitrum One' },
      { id: 'OPTIMISM', name: 'Optimism' },
    ],
  },
  {
    id: 'SOL',
    name: 'Solana',
    coinGeckoId: 'solana',
    coinPaprikaId: 'sol-solana',
    networks: [
      { id: 'SOLANA', name: 'Solana (natif)' },
      { id: 'ERC20', name: 'Ethereum (SOL envelopé)' },
      { id: 'BEP20', name: 'BNB Smart Chain (SOL envelopé)' },
    ],
  },
];
