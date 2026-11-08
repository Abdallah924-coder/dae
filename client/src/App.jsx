import React, { useCallback, useEffect, useMemo, useState } from 'react';

const assetsFallback = [
  {
    id: 'USDT',
    name: 'Tether',
    networks: [
      { id: 'TRC20', name: 'Tron (TRC20)' },
      { id: 'BEP20', name: 'BNB Smart Chain (BEP20)' },
      { id: 'ERC20', name: 'Ethereum (ERC20)' },
    ],
  },
  {
    id: 'BTC',
    name: 'Bitcoin',
    networks: [
      { id: 'BITCOIN', name: 'Bitcoin (natif)' },
      { id: 'LIGHTNING', name: 'Lightning Network' },
      { id: 'BEP20', name: 'BNB Smart Chain (BTC envelopé)' },
    ],
  },
  {
    id: 'POL',
    name: 'Polygon',
    networks: [
      { id: 'POLYGON', name: 'Polygon (natif)' },
      { id: 'ERC20', name: 'Ethereum (POL envelopé)' },
      { id: 'BEP20', name: 'BNB Smart Chain (POL envelopé)' },
    ],
  },
  {
    id: 'ETH',
    name: 'Ethereum',
    networks: [
      { id: 'ETHEREUM', name: 'Ethereum (natif)' },
      { id: 'ARBITRUM', name: 'Arbitrum One' },
      { id: 'OPTIMISM', name: 'Optimism' },
    ],
  },
  {
    id: 'SOL',
    name: 'Solana',
    networks: [
      { id: 'SOLANA', name: 'Solana (natif)' },
      { id: 'ERC20', name: 'Ethereum (SOL envelopé)' },
      { id: 'BEP20', name: 'BNB Smart Chain (SOL envelopé)' },
    ],
  },
];
const statusNames = {
  created: 'En attente',
  payment_declared: 'Paiement déclaré',
  processing: 'En traitement',
  completed: 'Terminée',
  cancelled: 'Annulée',
  expired: 'Expirée',
  failed: 'Échouée',
};
const money = (v) =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(v) || 0)} FCFA`;
const number = (v, digits = 8) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(Number(v) || 0);
async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (options.admin) {
    const token = sessionStorage.getItem('dae-admin-session');
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}
function Link({ to, children, className = '', ...props }) {
  return (
    <a href={to} className={className} {...props}>
      {children}
    </a>
  );
}
function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="nav-wrap">
        <Link to="/" className="brand">
          <img src="/images/dae-logo.png" alt="DAE Crypto" />
        </Link>
        <button
          className="mobile-menu"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Menu"
        >
          ☰
        </button>
        <nav className={open ? 'nav-links open' : 'nav-links'}>
          <Link to="/#marches">Marchés</Link>
          <Link to="/contact">Assistance</Link>
          <Link to="/suivi">Suivre une commande</Link>
          <Link to="/admin" className="nav-admin">
            Espace équipe
          </Link>
          <Link to="/vendre" className="button button-quiet">
            Vendre
          </Link>
          <Link to="/acheter" className="button button-primary">
            Acheter
          </Link>
        </nav>
      </div>
    </header>
  );
}
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span>© {new Date().getFullYear()} DAE Crypto · République du Congo</span>
        <div>
          <Link to="/contact">Assistance</Link>
          <Link to="/suivi">Suivi de commande</Link>
          <Link to="/admin">Administration</Link>
        </div>
      </div>
    </footer>
  );
}
function Shell({ children }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
function Notice({ children, type = 'error' }) {
  return children ? (
    <div className={`notice ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  ) : null;
}
function Home() {
  const [markets, setMarkets] = useState([]);
  const [updated, setUpdated] = useState('');
  const [rates, setRates] = useState(null);
  const [query, setQuery] = useState('');
  const [marketTab, setMarketTab] = useState('Tous');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [m, r] = await Promise.all([api('/api/markets'), api('/api/rates')]);
        if (alive) {
          setMarkets(m.markets || []);
          setUpdated(new Date(m.updatedAt).toLocaleTimeString('fr-FR'));
          setRates(r);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const visibleMarkets = (
    markets.length
      ? markets
      : assetsFallback.map((a) => ({
          asset: a.id,
          name: a.name,
          priceUsd: a.id === 'USDT' ? 1 : 0,
          change24h: 0,
        }))
  ).filter((m) => {
    const matchQuery = `${m.asset} ${m.name}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchTab =
      marketTab === 'Tous' ||
      (marketTab === 'Populaires' && ['BTC', 'ETH', 'USDT'].includes(m.asset)) ||
      (marketTab === 'Stablecoins' && m.asset === 'USDT');
    return matchQuery && matchTab;
  });
  return (
    <Shell>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <i /> DAE · L’exchange pensé pour vous
            </div>
            <h1>
              Vos cryptos,
              <br />
              <span>en toute confiance.</span>
            </h1>
            <p>
              Achetez et vendez vos actifs numériques au Congo. Des taux affichés à l’avance, des
              paiements Mobile Money et un suivi clair à chaque étape.
            </p>
            <div className="hero-actions">
              <Link to="/acheter" className="button button-primary">
                Acheter <b>↗</b>
              </Link>
              <Link to="/vendre" className="button button-outline">
                Vendre <b>↗</b>
              </Link>
            </div>
            <div className="trust-row">
              <span>
                <b>01</b> Tarifs connus avant validation
              </span>
              <span>
                <b>02</b> Suivi avec référence unique
              </span>
            </div>
          </div>
          <div className="hero-card">
            <div className="card-top">
              <div>
                <span className="muted-light">TAUX DE CONVERSION · XAF</span>
                <h2>Un prix clair. Dès le départ.</h2>
              </div>
              <span className="live-pill">
                <i /> EN DIRECT
              </span>
            </div>
            <div className="rate-pair">
              <div className="rate-highlight">
                <span>Vous achetez 1 USDT</span>
                <strong>{rates ? money(rates.buyRate ?? rates.usdtXafRate) : '— FCFA'}</strong>
                <small>Prix de vente DAE</small>
              </div>
              <div className="rate-highlight">
                <span>Vous vendez 1 USDT</span>
                <strong>{rates ? money(rates.sellRate ?? rates.usdtXafRate) : '— FCFA'}</strong>
                <small>Prix de rachat DAE</small>
              </div>
            </div>
            <div className="hero-card-foot">
              <span>Le taux appliqué est confirmé avant votre commande.</span>
              <Link to="/suivi">
                Suivre une transaction <b>→</b>
              </Link>
            </div>
          </div>
        </section>
        <section id="marches" className="market-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow plain">VOTRE SÉLECTION</span>
              <h2>Explorez les marchés</h2>
              <p>Les cours de référence sont actualisés automatiquement.</p>
            </div>
            <span className="updated">
              <i /> {updated ? `Actualisé à ${updated}` : 'Actualisation des cours…'}
            </span>
          </div>
          <div className="market-toolbar">
            <div className="market-tabs" role="tablist" aria-label="Filtrer les actifs">
              {['Tous', 'Populaires', 'Stablecoins'].map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={marketTab === tab}
                  className={marketTab === tab ? 'active' : ''}
                  onClick={() => setMarketTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <label className="market-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un actif"
                aria-label="Rechercher un actif"
              />
            </label>
          </div>
          <div className="market-table-wrap">
            <table className="market-table">
              <thead>
                <tr>
                  <th>Actif</th>
                  <th>Prix de référence</th>
                  <th>Variation · 24 h</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleMarkets.map((m) => (
                  <tr key={m.asset}>
                    <td>
                      <div className="market-asset">
                        <span className={`coin coin-${m.asset}`}>{m.asset.slice(0, 1)}</span>
                        <span>
                          <strong>
                            {m.asset}
                            <small>{m.name}</small>
                          </strong>
                        </span>
                      </div>
                    </td>
                    <td className="market-price">
                      {m.priceUsd ? `$${number(m.priceUsd, m.priceUsd < 1 ? 6 : 2)}` : 'Sur devis'}
                    </td>
                    <td>
                      <span
                        className={(m.change24h || 0) >= 0 ? 'change positive' : 'change negative'}
                      >
                        {m.priceUsd
                          ? `${(m.change24h || 0) >= 0 ? '+' : ''}${number(m.change24h, 2)}%`
                          : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="market-actions">
                        <Link to={`/acheter?asset=${m.asset}`}>Acheter</Link>
                        <Link to={`/vendre?asset=${m.asset}`}>Vendre</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleMarkets.length && (
              <p className="market-empty">Aucun actif ne correspond à votre recherche.</p>
            )}
          </div>
        </section>
        <section className="how-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow plain">COMMENT ÇA MARCHE</span>
              <h2>Un parcours pensé pour vous</h2>
            </div>
          </div>
          <div className="feature-grid">
            <article>
              <span>↗</span>
              <h3>Achetez en quelques étapes</h3>
              <p>
                Choisissez votre crypto, indiquez votre portefeuille puis payez avec MTN ou Airtel
                Money.
              </p>
              <Link to="/acheter">Commencer un achat →</Link>
            </article>
            <article>
              <span>↙</span>
              <h3>Vendez en toute confiance</h3>
              <p>
                Un réseau identifié, un montant estimé et une réception sur votre compte Mobile
                Money.
              </p>
              <Link to="/vendre">Commencer une vente →</Link>
            </article>
            <article>
              <span>◎</span>
              <h3>Gardez le fil</h3>
              <p>Retrouvez le statut de votre opération à tout moment grâce à votre référence.</p>
              <Link to="/suivi">Suivre une commande →</Link>
            </article>
          </div>
        </section>
        <section className="cta-band">
          <div>
            <span className="eyebrow">PRÊT À COMMENCER ?</span>
            <h2>Votre prochaine transaction commence ici.</h2>
          </div>
          <Link to="/acheter" className="button button-light">
            Créer une commande <b>→</b>
          </Link>
        </section>
      </main>
    </Shell>
  );
}
function imageData(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type))
      return reject(Error('Choisissez une image JPEG, PNG ou WebP.'));
    if (file.size > 5 * 1024 * 1024) return reject(Error('La capture doit faire 5 Mo maximum.'));
    const reader = new FileReader();
    reader.onerror = () => reject(Error('Impossible de lire la capture.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(Error('Image illisible.'));
      image.onload = () => {
        const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.72);
        data.length > 1500000
          ? reject(Error('La capture optimisée reste trop volumineuse.'))
          : resolve(data);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function Exchange({ mode }) {
  const [config, setConfig] = useState(null),
    [rates, setRates] = useState(null),
    [markets, setMarkets] = useState([]);
  const [asset, setAsset] = useState(
      () => new URLSearchParams(location.search).get('asset') || 'USDT',
    ),
    [network, setNetwork] = useState(''),
    [cryptoTransferMethod, setCryptoTransferMethod] = useState('network'),
    [amount, setAmount] = useState('');
  const [step, setStep] = useState(1),
    [operator, setOperator] = useState('mtn'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState({
    wallet: '',
    binancePayId: '',
    phone: '',
    recipientName: '',
    email: '',
    proof: '',
    consent: false,
  });
  useEffect(() => {
    Promise.all([api('/api/config'), api('/api/rates'), api('/api/markets')])
      .then(([c, r, m]) => {
        setConfig(c);
        setRates(r);
        setMarkets(m.markets || []);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () =>
        api('/api/markets')
          .then((m) => setMarkets(m.markets || []))
          .catch(() => {}),
      60000,
    );
    return () => clearInterval(timer);
  }, []);
  const selectedAsset =
    config?.assets?.find((a) => a.id === asset) || assetsFallback.find((a) => a.id === asset);
  const selectedNetwork =
    cryptoTransferMethod === 'binance_pay'
      ? {
          id: 'BINANCE_PAY',
          name: 'Binance Pay (transfert interne)',
          address: config?.binancePayId || '',
        }
      : selectedAsset?.networks?.find((n) => n.id === network);
  const price = asset === 'USDT' ? 1 : markets.find((m) => m.asset === asset)?.priceUsd;
  const quote = useMemo(() => {
    const value = Number(amount);
    if (!rates || !price || !value || value <= 0) return null;
    const amountUsdt = mode === 'buy' ? value : value * price;
    const amountCrypto = mode === 'buy' ? value / price : value;
    const rate =
      mode === 'buy' ? (rates.buyRate ?? rates.usdtXafRate) : (rates.sellRate ?? rates.usdtXafRate);
    return {
      amountUsdt,
      amountCrypto,
      rate,
      xaf: mode === 'buy' ? Math.ceil(amountUsdt * rate) : Math.floor(amountUsdt * rate),
    };
  }, [amount, mode, price, rates]);
  const setField = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const minimum = mode === 'buy' ? rates?.buyMinXaf : rates?.sellMinXaf,
    maximum = mode === 'buy' ? rates?.buyMaxXaf : rates?.sellMaxXaf;
  const networkOptions = (selectedAsset?.networks || []).filter(
    (n) => mode === 'buy' || n.available,
  );
  function changeAsset(id) {
    setAsset(id);
    setNetwork('');
  }
  function changeCryptoTransferMethod(method) {
    setCryptoTransferMethod(method);
    setNetwork(method === 'binance_pay' ? 'BINANCE_PAY' : '');
  }
  function advance() {
    setError('');
    if (step === 1) {
      if (!quote || (cryptoTransferMethod === 'network' && !network))
        return setError('Choisissez un mode de transfert et un montant valide.');
      if (mode === 'sell' && cryptoTransferMethod === 'binance_pay' && !config?.binancePayId)
        return setError('L’ID Binance de réception DAE n’est pas encore configuré.');
      if (minimum && (quote.xaf < minimum || quote.xaf > maximum))
        return setError(
          `Le montant doit être compris entre ${money(minimum)} et ${money(maximum)}.`,
        );
      setStep(2);
    } else if (step === 2) {
      const invalid = [...document.querySelectorAll('.exchange-panel input:invalid')].find(
        (el) => el.getClientRects().length,
      );
      if (invalid) return invalid.reportValidity();
      if (mode === 'buy' && !config?.paymentNumbers?.[operator])
        return setError('Ce moyen de paiement n’est pas encore configuré.');
      if (mode === 'sell' && cryptoTransferMethod === 'network' && !selectedNetwork?.address)
        return setError('Adresse de dépôt non configurée pour ce réseau.');
      setStep(3);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!form.consent) return setError('Veuillez confirmer les détails de la transaction.');
    setBusy(true);
    try {
      const file = document.getElementById('proof-file').files[0];
      const proofImage = await imageData(file);
      const result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          asset,
          amount: mode === 'buy' ? quote.amountUsdt : quote.amountCrypto,
          network: cryptoTransferMethod === 'binance_pay' ? 'BINANCE_PAY' : network,
          cryptoTransferMethod,
          operator,
          phone: form.phone,
          recipientName: mode === 'sell' ? form.recipientName : undefined,
          email: form.email,
          wallet: mode === 'buy' && cryptoTransferMethod === 'network' ? form.wallet : undefined,
          binancePayId:
            mode === 'buy' && cryptoTransferMethod === 'binance_pay'
              ? form.binancePayId
              : undefined,
          proof: form.proof,
          proofImage,
        }),
      });
      location.assign(
        `/attente?ref=${encodeURIComponent(result.ref)}${result.notificationSent ? '' : '&notification=failed'}`,
      );
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  const ready = config && rates;
  return (
    <Shell>
      <main className="page-wrap">
        <div className="page-intro">
          <Link to="/" className="back-link">
            ← Accueil
          </Link>
          <span className="eyebrow plain">ÉCHANGE SÉCURISÉ</span>
          <h1>{mode === 'buy' ? 'Acheter une crypto' : 'Vendre une crypto'}</h1>
          <p>
            {mode === 'buy'
              ? 'Votre montant est calculé en direct avant confirmation. Préparez votre portefeuille et votre moyen de paiement.'
              : 'Vérifiez le réseau de dépôt et le montant estimé avant d’envoyer vos actifs.'}
          </p>
        </div>
        <div className="exchange-layout">
          <form className="exchange-panel" onSubmit={submit}>
            <div className="stepper">
              {['Montant', 'Coordonnées', 'Confirmation'].map((label, i) => (
                <div
                  className={step === i + 1 ? 'step active' : step > i + 1 ? 'step done' : 'step'}
                  key={label}
                >
                  <span>{step > i + 1 ? '✓' : `0${i + 1}`}</span>
                  {label}
                </div>
              ))}
            </div>
            <Notice>{error}</Notice>
            {!ready ? (
              <div className="loading">Chargement des taux et des réseaux…</div>
            ) : (
              <>
                {step === 1 && (
                  <section>
                    <h2>Quel actif souhaitez-vous {mode === 'buy' ? 'acheter' : 'vendre'} ?</h2>
                    <div className="asset-grid">
                      {config.assets.map((a) => (
                        <button
                          type="button"
                          key={a.id}
                          onClick={() => changeAsset(a.id)}
                          className={asset === a.id ? 'asset-option selected' : 'asset-option'}
                        >
                          <span className={`coin coin-${a.id}`}>{a.id.slice(0, 1)}</span>
                          <span>
                            <strong>{a.id}</strong>
                            <small>{a.name}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <fieldset className="transfer-method-picker">
                      <legend>
                        {mode === 'buy'
                          ? 'Comment recevoir votre crypto ?'
                          : 'Comment envoyer votre crypto ?'}
                      </legend>
                      <div className="transfer-method-options">
                        <button
                          type="button"
                          className={
                            cryptoTransferMethod === 'network'
                              ? 'transfer-method active'
                              : 'transfer-method'
                          }
                          onClick={() => changeCryptoTransferMethod('network')}
                        >
                          <strong>Réseau blockchain</strong>
                          <small>
                            {mode === 'buy' ? 'Adresse de portefeuille' : 'Transfert sur un réseau'}
                          </small>
                        </button>
                        <button
                          type="button"
                          className={
                            cryptoTransferMethod === 'binance_pay'
                              ? 'transfer-method active'
                              : 'transfer-method'
                          }
                          disabled={mode === 'sell' && !config.binancePayId}
                          onClick={() => changeCryptoTransferMethod('binance_pay')}
                        >
                          <strong>Binance Pay</strong>
                          <small>
                            {mode === 'buy'
                              ? 'Recevoir sur votre Binance ID'
                              : 'Envoyer à DAE via Binance ID'}
                          </small>
                        </button>
                      </div>
                      {cryptoTransferMethod === 'network' ? (
                        <label className="field-label">
                          Réseau
                          <select
                            required
                            value={network}
                            onChange={(e) => setNetwork(e.target.value)}
                          >
                            <option value="">Sélectionnez le réseau</option>
                            {networkOptions.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.name}
                              </option>
                            ))}
                          </select>
                          {mode === 'sell' &&
                            selectedAsset.networks.length > networkOptions.length && (
                              <small>
                                Certains réseaux n’ont pas encore d’adresse de dépôt configurée.
                              </small>
                            )}
                        </label>
                      ) : (
                        <div className="payment-instructions">
                          {mode === 'buy' ? (
                            <small>
                              Vous saisirez votre Binance UID à l’étape suivante. DAE effectuera le
                              transfert manuellement après vérification du paiement.
                            </small>
                          ) : (
                            <>
                              <strong>Binance UID de réception DAE</strong>
                              <p className="address">{config.binancePayId}</p>
                              <small>
                                Envoyez uniquement {asset} depuis Binance Pay. Vérifiez l’UID avant
                                confirmation : les transferts Binance Pay sont irréversibles. DAE
                                vérifiera manuellement la réception.
                              </small>
                            </>
                          )}
                        </div>
                      )}
                    </fieldset>
                    <label className="field-label">
                      {mode === 'buy' ? 'Montant en USDT' : `Quantité en ${asset}`}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        inputMode="decimal"
                        placeholder={mode === 'buy' ? 'Ex. 50 USDT' : `Ex. 0,01 ${asset}`}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                    <div className="quote-box">
                      <div>
                        <span>{mode === 'buy' ? 'Vous recevrez environ' : 'Valeur estimée'}</span>
                        <strong>{quote ? `${number(quote.amountCrypto)} ${asset}` : '—'}</strong>
                      </div>
                      <div>
                        <span>{mode === 'buy' ? 'Total à payer' : 'Vous recevrez environ'}</span>
                        <strong>{quote ? money(quote.xaf) : '— FCFA'}</strong>
                      </div>
                      <small>
                        1 USDT ={' '}
                        {money(quote?.rate ?? (mode === 'buy' ? rates.buyRate : rates.sellRate))}
                        {markets.find((m) => m.asset === asset)?.stale ? ' · cours en cache' : ''}
                      </small>
                    </div>
                  </section>
                )}
                {step === 2 && (
                  <section id="customer-fields">
                    <h2>
                      {mode === 'buy'
                        ? cryptoTransferMethod === 'binance_pay'
                          ? 'Votre Binance UID et le paiement'
                          : 'Votre portefeuille et le paiement'
                        : 'Vos coordonnées de réception'}
                    </h2>
                    {mode === 'buy' && (
                      <div className="payment-instructions">
                        <strong>Paiement {operator.toUpperCase()} Money</strong>
                        <p>
                          {config.paymentRecipientNames?.[operator]} ·{' '}
                          {config.paymentNumbers?.[operator] || 'Numéro non configuré'}
                        </p>
                        <small>{config.paymentInstructions}</small>
                      </div>
                    )}
                    {mode === 'sell' && (
                      <div className="payment-instructions">
                        <strong>
                          {cryptoTransferMethod === 'binance_pay'
                            ? 'Binance UID de réception DAE'
                            : `Adresse de dépôt · ${selectedNetwork?.name}`}
                        </strong>
                        <p className="address">
                          {selectedNetwork?.address || 'Adresse à configurer'}
                        </p>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            navigator.clipboard?.writeText(selectedNetwork?.address || '')
                          }
                        >
                          {cryptoTransferMethod === 'binance_pay'
                            ? 'Copier l’UID Binance'
                            : 'Copier l’adresse'}
                        </button>
                        {cryptoTransferMethod === 'binance_pay' && (
                          <small>
                            Envoyez le montant exact depuis Binance Pay et joignez sa preuve de
                            transfert.
                          </small>
                        )}
                      </div>
                    )}
                    <fieldset className="operator-choice">
                      <legend>{mode === 'buy' ? 'Payer avec' : 'Recevoir sur'}</legend>
                      {['mtn', 'airtel'].map((op) => (
                        <label
                          key={op}
                          className={operator === op ? 'radio-card chosen' : 'radio-card'}
                        >
                          <input
                            type="radio"
                            name="operator"
                            value={op}
                            checked={operator === op}
                            onChange={() => setOperator(op)}
                          />
                          <span className={`operator-dot ${op}`}>{op === 'mtn' ? 'M' : 'A'}</span>
                          {op === 'mtn' ? 'MTN Money' : 'Airtel Money'}
                        </label>
                      ))}
                    </fieldset>
                    {mode === 'buy' && cryptoTransferMethod === 'network' && (
                      <label className="field-label">
                        Adresse de réception crypto
                        <input
                          required
                          minLength="20"
                          maxLength={network === 'LIGHTNING' ? 7100 : 2000}
                          value={form.wallet}
                          onChange={(e) => setField('wallet', e.target.value)}
                          placeholder="Votre adresse de portefeuille"
                        />
                      </label>
                    )}
                    {mode === 'buy' && cryptoTransferMethod === 'binance_pay' && (
                      <label className="field-label">
                        Votre Binance UID
                        <input
                          required
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]{4,32}"
                          maxLength="32"
                          value={form.binancePayId}
                          onChange={(e) => setField('binancePayId', e.target.value.trim())}
                          placeholder="Votre identifiant numérique Binance"
                        />
                        <small>
                          Vérifiez attentivement l’UID : les transferts Binance Pay sont
                          irréversibles. DAE effectuera l’envoi manuellement après validation du
                          paiement.
                        </small>
                      </label>
                    )}
                    <div className="field-row">
                      <label className="field-label">
                        Téléphone Mobile Money
                        <input
                          required
                          type="tel"
                          autoComplete="tel"
                          value={form.phone}
                          onChange={(e) => setField('phone', e.target.value)}
                          placeholder="+242…"
                        />
                      </label>
                      {mode === 'sell' && (
                        <label className="field-label">
                          Nom du bénéficiaire
                          <input
                            required
                            maxLength="100"
                            value={form.recipientName}
                            onChange={(e) => setField('recipientName', e.target.value)}
                          />
                        </label>
                      )}
                    </div>
                    <label className="field-label">
                      Adresse e-mail
                      <input
                        required
                        type="email"
                        maxLength="160"
                        autoComplete="email"
                        value={form.email}
                        onChange={(e) => setField('email', e.target.value)}
                        placeholder="vous@exemple.com"
                      />
                    </label>
                    <button type="button" className="button button-outline" onClick={advance}>
                      Vérifier les coordonnées →
                    </button>
                  </section>
                )}
                {step === 3 && (
                  <section>
                    <h2>
                      {mode === 'buy' ? 'Confirmez votre paiement' : 'Confirmez votre transfert'}
                    </h2>
                    <div className="review-box">
                      <p>
                        <span>Opération</span>
                        <strong>
                          {mode === 'buy' ? 'Achat' : 'Vente'} {asset}
                        </strong>
                      </p>
                      <p>
                        <span>Montant</span>
                        <strong>
                          {number(quote?.amountCrypto)} {asset}
                        </strong>
                      </p>
                      <p>
                        <span>Mode de transfert</span>
                        <strong>{selectedNetwork?.name}</strong>
                      </p>
                      <p>
                        <span>{mode === 'buy' ? 'À payer' : 'À recevoir'}</span>
                        <strong>{money(quote?.xaf)}</strong>
                      </p>
                      <p>
                        <span>Taux appliqué</span>
                        <strong>{money(quote?.rate)} / USDT</strong>
                      </p>
                    </div>
                    <label className="field-label">
                      Capture du {mode === 'buy' ? 'paiement' : 'transfert'}
                      <input
                        id="proof-file"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        required
                      />
                    </label>
                    <label className="field-label">
                      {mode === 'buy' ? 'Référence du paiement' : 'Hash / ID de transaction'}
                      <input
                        required
                        minLength="6"
                        maxLength="200"
                        value={form.proof}
                        onChange={(e) => setField('proof', e.target.value)}
                      />
                    </label>
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={form.consent}
                        onChange={(e) => setField('consent', e.target.checked)}
                      />
                      Je confirme le montant, le mode de transfert et les coordonnées affichés.
                    </label>
                    <button className="button button-primary full" disabled={busy}>
                      {busy ? 'Envoi en cours…' : 'Créer la commande et la suivre'}
                    </button>
                  </section>
                )}
                <div className="form-actions">
                  {step > 1 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setError('');
                        setStep(step - 1);
                      }}
                    >
                      ← Retour
                    </button>
                  )}
                  {step === 1 && (
                    <button type="button" className="button button-primary" onClick={advance}>
                      Continuer →
                    </button>
                  )}
                </div>
              </>
            )}
          </form>
          <aside className="exchange-aside">
            <span className="aside-icon">◈</span>
            <h3>Une opération transparente</h3>
            <p>Votre taux et le total sont affichés avant l’envoi de votre commande.</p>
            <div className="aside-separator" />
            <p>Conservez votre référence : vous pourrez consulter l’avancement à tout moment.</p>
            <Link to="/suivi">Retrouver une commande →</Link>
            <Link to="/contact">Besoin d’aide ?</Link>
          </aside>
        </div>
      </main>
    </Shell>
  );
}
function Tracking() {
  const isPendingPage = location.pathname.replace(/\/$/, '') === '/attente';
  const initialRef = new URLSearchParams(location.search).get('ref') || '';
  const [ref, setRef] = useState(initialRef);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const lookup = useCallback(
    async (event) => {
      event?.preventDefault();
      const value = ref.trim();
      if (!value) return;
      setLoading(true);
      setError('');
      try {
        const data = await api(`/api/orders/${encodeURIComponent(value)}`);
        setOrder(data);
        history.replaceState({}, '', `/suivi?ref=${encodeURIComponent(value)}`);
      } catch (e) {
        setOrder(null);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [ref],
  );
  useEffect(() => {
    if (initialRef) lookup();
  }, []);
  useEffect(() => {
    if (!order || ['completed', 'cancelled', 'expired', 'failed'].includes(order.status)) return;
    const t = setInterval(() => lookup(), 10000);
    return () => clearInterval(t);
  }, [order, lookup]);
  return (
    <Shell>
      <main className="page-wrap narrow">
        <div className="page-intro">
          <span className="eyebrow plain">
            {isPendingPage ? 'DEMANDE ENREGISTRÉE' : 'ESPACE CLIENT'}
          </span>
          <h1>{isPendingPage ? 'Votre opération est en route.' : 'Suivre ma commande'}</h1>
          <p>
            {isPendingPage
              ? 'Retrouvez ci-dessous le statut de votre demande. Gardez votre référence pour la consulter à tout moment.'
              : 'Entrez la référence reçue après votre demande pour consulter son avancement.'}
          </p>
        </div>
        <section className="tracking-card">
          <form className="tracking-search" onSubmit={lookup}>
            <label className="field-label">
              Référence de commande
              <input
                required
                placeholder="CMD-…"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            </label>
            <button className="button button-primary" disabled={loading}>
              {loading ? 'Recherche…' : 'Suivre'}
            </button>
          </form>
          <Notice>{error}</Notice>
          {order && (
            <div className="order-view">
              <div className="order-heading">
                <div>
                  <small>RÉFÉRENCE</small>
                  <h2>{order.ref}</h2>
                </div>
                <span className={`status status-${order.status}`}>
                  {statusNames[order.status] || order.status}
                </span>
              </div>
              <p className="status-description">
                {
                  {
                    created: 'Commande créée. Nous attendons la déclaration de votre paiement.',
                    payment_declared: 'Votre preuve est reçue et en attente de vérification.',
                    processing: 'Votre paiement est validé. Votre opération est en cours.',
                    completed: 'Opération terminée. Merci de votre confiance.',
                    cancelled:
                      'Cette commande a été annulée. Contactez notre équipe si vous avez déjà payé.',
                    expired: 'Cette commande a expiré.',
                    failed: 'Le traitement a rencontré un problème. Contactez notre équipe.',
                  }[order.status]
                }
              </p>
              <div className="timeline">
                {['created', 'payment_declared', 'processing', 'completed'].map((s, i) => {
                  const stages = ['created', 'payment_declared', 'processing', 'completed'];
                  const index = stages.indexOf(order.status);
                  return (
                    <div className={i <= index ? 'timeline-step reached' : 'timeline-step'} key={s}>
                      <i>{i < index ? '✓' : `0${i + 1}`}</i>
                      <span>{['Commande créée', 'Preuve reçue', 'Traitement', 'Terminée'][i]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="review-box">
                <p>
                  <span>Opération</span>
                  <strong>
                    {order.mode === 'buy' ? 'Achat' : 'Vente'} · {order.asset}
                  </strong>
                </p>
                <p>
                  <span>Montant crypto</span>
                  <strong>
                    {number(order.amountCrypto)} {order.asset}
                  </strong>
                </p>
                <p>
                  <span>Valeur</span>
                  <strong>{money(order.amountXaf)}</strong>
                </p>
                <p>
                  <span>Mode de transfert</span>
                  <strong>{order.networkName || order.network}</strong>
                </p>
                {order.cryptoTransferMethod === 'binance_pay' && (
                  <p>
                    <span>Binance UID destinataire</span>
                    <strong>{order.binancePayId}</strong>
                  </p>
                )}
                <p>
                  <span>Créée le</span>
                  <strong>{new Date(order.createdAt).toLocaleString('fr-FR')}</strong>
                </p>
              </div>
              <p className="tracking-footnote">
                Le statut s’actualise automatiquement. Vous recevrez également une notification
                selon les coordonnées fournies.
              </p>
            </div>
          )}
        </section>
      </main>
    </Shell>
  );
}
function Contact() {
  const [config, setConfig] = useState(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/config')
      .then(setConfig)
      .catch(() => {});
  }, []);
  async function submit(e) {
    e.preventDefault();
    const formElement = e.currentTarget;
    setError('');
    setBusy(true);
    const f = new FormData(formElement);
    try {
      await api('/api/contact', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
      setDone(true);
      formElement.reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <main className="page-wrap narrow">
        <div className="page-intro">
          <span className="eyebrow plain">ASSISTANCE DAE</span>
          <h1>Parlons de votre besoin.</h1>
          <p>
            Une question sur une commande, un réseau ou un paiement ? Notre équipe est là pour vous
            aider.
          </p>
        </div>
        <section className="tracking-card contact-layout">
          <div>
            <h2>Nos coordonnées</h2>
            {config?.contactWhatsApp && (
              <a
                className="contact-method"
                href={
                  config.contactWhatsApp.startsWith('https://')
                    ? config.contactWhatsApp
                    : `https://wa.me/${config.contactWhatsApp.replace(/\D/g, '')}`
                }
                target="_blank"
                rel="noreferrer"
              >
                <span>◉</span>
                <div>
                  <small>WHATSAPP</small>
                  <strong>{config.contactWhatsApp}</strong>
                </div>
                <b>↗</b>
              </a>
            )}
            {config?.contactEmail && (
              <a className="contact-method" href={`mailto:${config.contactEmail}`}>
                <span>✉</span>
                <div>
                  <small>E-MAIL</small>
                  <strong>{config.contactEmail}</strong>
                </div>
                <b>↗</b>
              </a>
            )}
            <div className="support-note">
              Pour une demande liée à une transaction, indiquez sa référence dans votre message.
            </div>
          </div>
          <form onSubmit={submit}>
            <h2>Écrire à l’équipe</h2>
            <label className="field-label">
              Nom
              <input name="name" required maxLength="100" />
            </label>
            <label className="field-label">
              E-mail
              <input name="email" type="email" required maxLength="160" />
            </label>
            <label className="field-label">
              Message
              <textarea name="message" required maxLength="1500" rows="5" />
            </label>
            <Notice>{error}</Notice>
            {done && (
              <Notice type="success">
                Message envoyé. L’équipe vous répondra dès que possible.
              </Notice>
            )}
            <button className="button button-primary full" disabled={busy}>
              {busy ? 'Envoi…' : 'Envoyer le message'}
            </button>
          </form>
        </section>
      </main>
    </Shell>
  );
}
function Admin() {
  const [token, setToken] = useState(sessionStorage.getItem('dae-admin-session') || '');
  const [loginError, setLoginError] = useState('');
  const [tab, setTab] = useState('dashboard');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [orders, setOrders] = useState([]);
  const [rates, setRates] = useState([]);
  const [settings, setSettings] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [rateForm, setRateForm] = useState({
    buyRate: 635,
    sellRate: 580,
    buyMinXaf: 10000,
    buyMaxXaf: 500000,
    sellMinXaf: 10000,
    sellMaxXaf: 500000,
  });
  const notify = (text, bad = false) => {
    setNotice(text);
    setError(bad);
    setTimeout(() => setNotice(''), 5000);
  };
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [d, o, r, s] = await Promise.all([
        api('/api/admin/dashboard', { admin: true }),
        api(`/api/admin/orders${statusFilter ? `?status=${statusFilter}` : ''}`, { admin: true }),
        api('/api/admin/rates', { admin: true }),
        api('/api/admin/settings', { admin: true }),
      ]);
      setDashboard(d);
      setOrders(o);
      setRates(r);
      setSettings(s);
      if (r[0])
        setRateForm({
          buyRate: r[0].buyRate,
          sellRate: r[0].sellRate,
          buyMinXaf: r[0].buyMinXaf ?? r[0].minXaf,
          buyMaxXaf: r[0].buyMaxXaf ?? r[0].maxXaf,
          sellMinXaf: r[0].sellMinXaf ?? r[0].minXaf,
          sellMaxXaf: r[0].sellMaxXaf ?? r[0].maxXaf,
        });
    } catch (e) {
      if (e.message.toLowerCase().includes('session')) logout();
      notify(e.message, true);
    }
  }, [token, statusFilter]);
  useEffect(() => {
    if (token) load();
  }, [token, load]);
  function logout() {
    sessionStorage.removeItem('dae-admin-session');
    setToken('');
    setDashboard(null);
  }
  async function login(e) {
    e.preventDefault();
    setLoginError('');
    const f = new FormData(e.currentTarget);
    try {
      const result = await api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(f)),
      });
      sessionStorage.setItem('dae-admin-session', result.token);
      setToken(result.token);
    } catch (err) {
      setLoginError(err.message);
    }
  }
  async function updateStatus(order, status) {
    try {
      await api(`/api/admin/orders/${encodeURIComponent(order.ref)}`, {
        method: 'PATCH',
        admin: true,
        body: JSON.stringify({ status, note: '' }),
      });
      notify(`Commande ${order.ref} mise à jour.`);
      setSelected(null);
      await load();
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function inspect(order) {
    setSelected(order);
    try {
      const [proof, history] = await Promise.all([
        api(`/api/admin/orders/${encodeURIComponent(order.ref)}/proof`, { admin: true }),
        api(`/api/admin/orders/${encodeURIComponent(order.ref)}/events`, { admin: true }),
      ]);
      setSelected({ ...order, proofData: proof });
      setEvents(history);
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function saveRates(e) {
    e.preventDefault();
    try {
      await api('/api/admin/rates', {
        method: 'POST',
        admin: true,
        body: JSON.stringify(
          Object.fromEntries(Object.entries(rateForm).map(([k, v]) => [k, Number(v)])),
        ),
      });
      notify('Taux et limites enregistrés.');
      await load();
    } catch (e) {
      notify(e.message, true);
    }
  }
  function updateSetting(key, value) {
    setSettings((old) => ({ ...old, [key]: value }));
  }
  async function saveSettings(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const networks = {};
    settings.assets.forEach((a) => {
      networks[a.id] = a.networks.map((n) => ({ id: n.id, name: n.name, address: n.address }));
    });
    const payload = {
      paymentNumbers: { mtn: fd.get('paymentMtn'), airtel: fd.get('paymentAirtel') },
      paymentRecipientNames: { mtn: fd.get('recipientMtn'), airtel: fd.get('recipientAirtel') },
      binancePayId: fd.get('binancePayId'),
      paymentInstructions: fd.get('paymentInstructions'),
      contactWhatsApp: fd.get('contactWhatsApp'),
      contactEmail: fd.get('contactEmail'),
      maintenance: { enabled: fd.has('maintenanceEnabled'), message: fd.get('maintenanceMessage') },
      networks,
    };
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        admin: true,
        body: JSON.stringify(payload),
      });
      notify('Configuration enregistrée.');
      await load();
    } catch (e) {
      notify(e.message, true);
    }
  }
  const filtered = orders.filter((o) =>
    `${o.ref} ${o.email || ''} ${o.phone || ''} ${o.asset || ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  if (!token)
    return (
      <main className="admin-login">
        <Link to="/" className="brand">
          <img src="/images/dae-logo.png" alt="DAE Crypto" />
        </Link>
        <section>
          <span className="eyebrow plain">ESPACE ÉQUIPE</span>
          <h1>Connexion à l’administration</h1>
          <p>Accédez aux commandes, aux taux et aux paramètres de la plateforme.</p>
          <form onSubmit={login}>
            <label className="field-label">
              E-mail
              <input type="email" name="email" required autoComplete="username" />
            </label>
            <label className="field-label">
              Mot de passe
              <input type="password" name="password" required autoComplete="current-password" />
            </label>
            <Notice>{loginError}</Notice>
            <button className="button button-primary full">Se connecter</button>
          </form>
        </section>
      </main>
    );
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Link to="/" className="brand">
          <img src="/images/dae-logo.png" alt="DAE Crypto" />
        </Link>
        <div className="admin-label">ESPACE DE GESTION</div>
        {[
          ['dashboard', '▦', 'Vue d’ensemble'],
          ['orders', '⇄', 'Commandes'],
          ['rates', '◷', 'Taux & limites'],
          ['settings', '⚙', 'Configuration'],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            className={tab === id ? 'admin-nav active' : 'admin-nav'}
            onClick={() => setTab(id)}
          >
            <span>{icon}</span>
            {label}
            {id === 'orders' && dashboard?.pendingCount > 0 && <i>{dashboard.pendingCount}</i>}
          </button>
        ))}
        <div className="sidebar-bottom">
          <Link to="/" className="admin-nav">
            <span>↗</span>Voir le site
          </Link>
          <button className="admin-nav" onClick={logout}>
            <span>⇥</span>Déconnexion
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-topbar">
          <span>
            Administration <b>/</b>{' '}
            {
              {
                dashboard: 'Vue d’ensemble',
                orders: 'Commandes',
                rates: 'Taux & limites',
                settings: 'Configuration',
              }[tab]
            }
          </span>
          <div>
            <span className="live-pill">
              <i /> EN LIGNE
            </span>
            <button className="button button-outline compact" onClick={load}>
              Actualiser ↻
            </button>
            <button className="button button-outline compact top-logout" onClick={logout}>
              Déconnexion
            </button>
          </div>
        </div>
        <div className="admin-content">
          <div className="admin-title">
            <div>
              <span className="eyebrow plain">GESTION DAE CRYPTO</span>
              <h1>
                {
                  {
                    dashboard: 'Vue d’ensemble',
                    orders: 'Commandes',
                    rates: 'Taux & limites',
                    settings: 'Configuration',
                  }[tab]
                }
              </h1>
            </div>
            <span className="admin-date">
              {new Date().toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
          <Notice type={error ? 'error' : 'success'}>{notice}</Notice>
          {tab === 'dashboard' && (
            <>
              {dashboard ? (
                <>
                  <div className="stats-grid">
                    {[
                      ['Commandes reçues', dashboard.total.count, 'Toutes périodes'],
                      ['À traiter', dashboard.pendingCount, 'En attente ou en cours'],
                      ['Volume global', money(dashboard.total.amountXaf), 'Achats et ventes'],
                      [
                        'Ventes terminées',
                        dashboard.sell.completedCount,
                        money(dashboard.sell.completedXaf),
                      ],
                    ].map(([label, value, sub]) => (
                      <article className="stat-card" key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                        <small>{sub}</small>
                      </article>
                    ))}
                  </div>
                  <div className="admin-card">
                    <div className="card-heading">
                      <div>
                        <h2>Activité par opération</h2>
                        <p>Vue synthétique des achats et des ventes.</p>
                      </div>
                      <button className="text-button" onClick={() => setTab('orders')}>
                        Voir les commandes →
                      </button>
                    </div>
                    <div className="activity-grid">
                      {['buy', 'sell'].map((side) => (
                        <div className="activity-card" key={side}>
                          <span className="activity-icon">{side === 'buy' ? '↗' : '↙'}</span>
                          <div>
                            <small>{side === 'buy' ? 'ACHATS' : 'VENTES'}</small>
                            <strong>{dashboard[side].count} commandes</strong>
                            <p>{money(dashboard[side].amountXaf)} de volume total</p>
                            <p>
                              {dashboard[side].completedCount} terminées ·{' '}
                              {dashboard[side].pendingCount} en cours
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="loading">Chargement de la synthèse…</div>
              )}
            </>
          )}
          {tab === 'orders' && (
            <div className="admin-card">
              <div className="card-heading">
                <div>
                  <h2>Gestion des commandes</h2>
                  <p>{orders.length} commandes affichées (jusqu’aux 200 plus récentes).</p>
                </div>
              </div>
              <div className="filters">
                <input
                  aria-label="Rechercher"
                  placeholder="Référence, e-mail, téléphone…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Tous les statuts</option>
                  {Object.entries(statusNames).map(([s, n]) => (
                    <option value={s} key={s}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Référence</th>
                      <th>Opération</th>
                      <th>Montant</th>
                      <th>Client</th>
                      <th>Statut</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o) => (
                      <tr key={o.ref}>
                        <td>
                          <button className="ref-link" onClick={() => inspect(o)}>
                            {o.ref}
                          </button>
                        </td>
                        <td>
                          {o.mode === 'buy' ? 'Achat' : 'Vente'} · {o.asset}
                        </td>
                        <td>
                          {number(o.amountCrypto ?? o.amountUsdt)} {o.asset}
                          <small>{money(o.amountXaf)}</small>
                        </td>
                        <td>
                          {o.email || o.phone}
                          <small>
                            {o.operator?.toUpperCase()} · {o.networkName || o.network}
                          </small>
                        </td>
                        <td>
                          <span className={`status status-${o.status}`}>
                            {statusNames[o.status] || o.status}
                          </span>
                        </td>
                        <td>{new Date(o.createdAt).toLocaleDateString('fr-FR')}</td>
                        <td>
                          <button
                            className="button button-outline compact"
                            onClick={() => inspect(o)}
                          >
                            Détails
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <div className="empty-state">
                    Aucune commande ne correspond à cette recherche.
                  </div>
                )}
              </div>
            </div>
          )}
          {tab === 'rates' && (
            <div className="admin-card">
              <div className="card-heading">
                <div>
                  <h2>Prix de conversion</h2>
                  <p>
                    Achat client : DAE vend les USDT. Vente client : DAE achète les USDT. Définissez
                    aussi les limites par transaction.
                  </p>
                </div>
              </div>
              <form className="rate-admin-form" onSubmit={saveRates}>
                <label className="field-label">
                  Client achète · DAE vend 1 USDT
                  <input
                    type="number"
                    min="1"
                    required
                    value={rateForm.buyRate}
                    onChange={(e) => setRateForm({ ...rateForm, buyRate: e.target.value })}
                  />
                  <small>FCFA par USDT</small>
                </label>
                <label className="field-label">
                  Client vend · DAE achète 1 USDT
                  <input
                    type="number"
                    min="1"
                    required
                    value={rateForm.sellRate}
                    onChange={(e) => setRateForm({ ...rateForm, sellRate: e.target.value })}
                  />
                  <small>FCFA par USDT</small>
                </label>
                {['buy', 'sell'].map((side) => (
                  <fieldset key={side}>
                    <legend>Limites {side === 'buy' ? 'd’achat' : 'de vente'} (FCFA)</legend>
                    <div className="field-row">
                      {['Min', 'Max'].map((label, i) => {
                        const key = `${side}${i ? 'Max' : 'Min'}Xaf`;
                        return (
                          <label className="field-label" key={key}>
                            {label}
                            <input
                              type="number"
                              min="1"
                              required
                              value={rateForm[key]}
                              onChange={(e) => setRateForm({ ...rateForm, [key]: e.target.value })}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
                <button className="button button-primary">Enregistrer les taux</button>
              </form>
              <h3 className="subheading">Historique récent</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Achat</th>
                      <th>Vente</th>
                      <th>Limites</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((r) => (
                      <tr key={r._id}>
                        <td>{new Date(r.createdAt).toLocaleString('fr-FR')}</td>
                        <td>{money(r.buyRate)} / USDT</td>
                        <td>{money(r.sellRate)} / USDT</td>
                        <td>
                          Achat {money(r.buyMinXaf ?? r.minXaf)} – {money(r.buyMaxXaf ?? r.maxXaf)}
                          <small>
                            Vente {money(r.sellMinXaf ?? r.minXaf)} –{' '}
                            {money(r.sellMaxXaf ?? r.maxXaf)}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {tab === 'settings' && settings && (
            <form className="settings-stack" onSubmit={saveSettings}>
              <div className="admin-card">
                <h2>Paiements et contact</h2>
                <p className="card-description">Coordonnées affichées dans le parcours client.</p>
                <div className="settings-grid">
                  <label className="field-label">
                    Bénéficiaire MTN
                    <input name="recipientMtn" defaultValue={settings.paymentRecipientNames?.mtn} />
                  </label>
                  <label className="field-label">
                    Numéro MTN
                    <input name="paymentMtn" defaultValue={settings.paymentNumbers?.mtn} />
                  </label>
                  <label className="field-label">
                    Bénéficiaire Airtel
                    <input
                      name="recipientAirtel"
                      defaultValue={settings.paymentRecipientNames?.airtel}
                    />
                  </label>
                  <label className="field-label">
                    Numéro Airtel
                    <input name="paymentAirtel" defaultValue={settings.paymentNumbers?.airtel} />
                  </label>
                  <label className="field-label">
                    Binance UID de réception DAE
                    <input
                      name="binancePayId"
                      inputMode="numeric"
                      pattern="[0-9]{4,32}"
                      maxLength="32"
                      defaultValue={settings.binancePayId || ''}
                      placeholder="UID numérique du compte Binance DAE"
                    />
                    <small>Utilisé pour les ventes envoyées à DAE via Binance Pay.</small>
                  </label>
                  <label className="field-label span-2">
                    Instructions de paiement
                    <textarea
                      name="paymentInstructions"
                      rows="3"
                      defaultValue={settings.paymentInstructions}
                    />
                  </label>
                  <label className="field-label">
                    WhatsApp
                    <input name="contactWhatsApp" defaultValue={settings.contactWhatsApp} />
                  </label>
                  <label className="field-label">
                    E-mail de contact
                    <input name="contactEmail" type="email" defaultValue={settings.contactEmail} />
                  </label>
                </div>
              </div>
              <div className="admin-card">
                <h2>Adresses de dépôt crypto</h2>
                <p className="card-description">
                  Vérifiez chaque réseau et adresse. Les adresses configurées sont proposées aux
                  clients qui vendent.
                </p>
                <div className="network-admin-grid">
                  {settings.assets.map((a, ai) => (
                    <fieldset className="network-asset" key={a.id}>
                      <legend>
                        {a.id} · {a.name}
                      </legend>
                      {a.networks.map((n, ni) => (
                        <div className="network-row" key={n.id}>
                          <b>{n.name}</b>
                          <input
                            aria-label={`Adresse ${a.id} ${n.name}`}
                            value={n.address}
                            onChange={(e) => {
                              const assets = [...settings.assets];
                              assets[ai].networks[ni].address = e.target.value;
                              setSettings({ ...settings, assets });
                            }}
                            placeholder="Adresse de dépôt (vide = indisponible)"
                          />
                        </div>
                      ))}
                    </fieldset>
                  ))}
                </div>
              </div>
              <div className="admin-card maintenance-card">
                <h2>Mode maintenance</h2>
                <label className="consent">
                  <input
                    name="maintenanceEnabled"
                    type="checkbox"
                    defaultChecked={settings.maintenance?.enabled}
                  />
                  Activer la maintenance du site
                </label>
                <label className="field-label">
                  Message affiché
                  <textarea
                    name="maintenanceMessage"
                    maxLength="500"
                    defaultValue={settings.maintenance?.message}
                    rows="2"
                  />
                </label>
              </div>
              <button className="button button-primary">Enregistrer la configuration</button>
            </form>
          )}
        </div>
      </main>
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section className="order-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Fermer">
              ×
            </button>
            <span className="eyebrow plain">DÉTAILS DE COMMANDE</span>
            <h2>{selected.ref}</h2>
            <span className={`status status-${selected.status}`}>
              {statusNames[selected.status]}
            </span>
            <div className="review-box">
              <p>
                <span>Opération</span>
                <strong>
                  {selected.mode === 'buy' ? 'Achat' : 'Vente'} · {selected.asset}
                </strong>
              </p>
              <p>
                <span>Montant</span>
                <strong>
                  {number(selected.amountCrypto ?? selected.amountUsdt)} {selected.asset}
                </strong>
              </p>
              <p>
                <span>Équivalent</span>
                <strong>{money(selected.amountXaf)}</strong>
              </p>
              <p>
                <span>Taux bloqué</span>
                <strong>{money(selected.rateApplied)} / USDT</strong>
              </p>
              <p>
                <span>Client</span>
                <strong>
                  {selected.email || '—'} · {selected.phone}
                </strong>
              </p>
              <p>
                <span>Mode de transfert</span>
                <strong>{selected.networkName || selected.network}</strong>
              </p>
              {selected.cryptoTransferMethod === 'binance_pay' && (
                <p>
                  <span>Binance UID destinataire</span>
                  <strong>{selected.binancePayId}</strong>
                </p>
              )}
            </div>
            {selected.proofData?.proof && (
              <p className="proof-line">
                <b>Preuve :</b> {selected.proofData.proof}
              </p>
            )}
            {selected.proofData?.image && (
              <img
                className="proof-image"
                src={selected.proofData.image}
                alt="Preuve de paiement"
              />
            )}
            <h3>Historique</h3>
            <div className="event-list">
              {events.map((event, i) => (
                <p key={event._id || i}>
                  <i />
                  {statusNames[event.to] || event.to}
                  <small>{new Date(event.createdAt).toLocaleString('fr-FR')}</small>
                </p>
              ))}
            </div>
            <div className="modal-actions">
              {['created', 'payment_declared'].includes(selected.status) && (
                <button
                  className="button button-primary"
                  onClick={() => updateStatus(selected, 'processing')}
                >
                  Valider et traiter
                </button>
              )}
              {['created', 'payment_declared', 'processing'].includes(selected.status) && (
                <button
                  className="button button-outline compact"
                  onClick={() => updateStatus(selected, 'completed')}
                >
                  Marquer terminée
                </button>
              )}
              {['created', 'payment_declared', 'processing'].includes(selected.status) && (
                <button
                  className="button button-danger"
                  onClick={() => updateStatus(selected, 'cancelled')}
                >
                  Annuler
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
export default function App() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  if (path === '/admin') return <Admin />;
  if (path === '/acheter') return <Exchange mode="buy" />;
  if (path === '/vendre') return <Exchange mode="sell" />;
  if (path === '/suivi' || path === '/attente') return <Tracking />;
  if (path === '/contact') return <Contact />;
  if (path === '/') return <Home />;
  return (
    <Shell>
      <main className="page-wrap narrow">
        <section className="tracking-card">
          <span className="eyebrow plain">PAGE INTROUVABLE</span>
          <h1>Cette page n’existe pas.</h1>
          <p>Le lien a peut-être changé. Revenez à l’accueil pour continuer.</p>
          <Link to="/" className="button button-primary">
            Retour à l’accueil
          </Link>
        </section>
      </main>
    </Shell>
  );
}
