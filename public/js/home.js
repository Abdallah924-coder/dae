(async function () {
  const list = document.getElementById('market-list');
  const updated = document.getElementById('market-updated');
  const error = document.getElementById('market-error');
  const logos = {
    USDT: 'https://cdn.simpleicons.org/tether/26A17B',
    BTC: 'https://cdn.simpleicons.org/bitcoin/F7931A',
    POL: 'https://cdn.simpleicons.org/polygon/8247E5',
    ETH: 'https://cdn.simpleicons.org/ethereum/627EEA',
    SOL: 'https://cdn.simpleicons.org/solana/9945FF',
  };

  function logo(asset) {
    const image = document.createElement('img');
    image.src = logos[asset] || '';
    image.alt = `${asset} logo`;
    image.className = 'h-7 w-7 object-contain';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'font-bold text-brand';
      fallback.textContent = asset.slice(0, 1);
      image.replaceWith(fallback);
    }, { once: true });
    return image;
  }

  async function refresh() {
    try {
      const data = await Dae.api('/api/markets');
      list.replaceChildren(...data.markets.map((market) => {
        const positive = market.change24h >= 0;
        const change = `${positive ? '+' : ''}${Number(market.change24h).toFixed(2)}%`;
        const card = document.createElement('article');
        card.className = 'rounded-2xl border border-slate-200 bg-white p-5 md:p-6';
        const identity = document.createElement('div');
        identity.className = 'flex items-center gap-3';
        const icon = document.createElement('span');
        icon.className = 'flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50';
        icon.append(logo(market.asset));
        const name = document.createElement('div');
        const title = document.createElement('h3');
        title.className = 'font-bold';
        title.textContent = market.asset;
        const subtitle = document.createElement('p');
        subtitle.className = 'text-xs text-slate-500';
        subtitle.textContent = market.asset === 'USDT' ? 'Tether' : market.name;
        name.append(title, subtitle);
        identity.append(icon, name);
        const price = document.createElement('p');
        price.className = 'mt-5 text-xl font-black';
        price.textContent = `${Dae.formatCrypto(market.priceUsd, market.priceUsd < 1 ? 6 : 2)} USD`;
        const movement = document.createElement('p');
        movement.className = `mt-1 text-xs ${positive ? 'text-emerald-600' : 'text-rose-600'}`;
        movement.textContent = `${change} · 24 h`;
        card.append(identity, price, movement);
        return card;
      }));
      error.classList.add('hidden');
      updated.textContent = `Cours CoinGecko ${data.stale ? 'en cache (dernière mise à jour' : 'actualisés à'} ${new Date(data.updatedAt).toLocaleTimeString('fr-FR')}${data.stale ? ')' : ''}`;
    } catch (err) {
      error.textContent = `Cours indisponibles pour le moment : ${err.message}`;
      error.classList.remove('hidden');
      updated.textContent = 'Cours indisponibles';
    }
  }
  refresh();
  window.setInterval(refresh, 60_000);
})();
