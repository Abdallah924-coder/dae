import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

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
const kycStatusNames = {
  not_started: 'Non démarrée',
  pending: 'En cours de vérification',
  approved: 'Validée',
  rejected: 'Action requise',
};
const eventActorNames = {
  customer: 'Client connecté',
  guest: 'Client invité',
  admin: 'Administration',
  system: 'Automatique',
};
const money = (v) =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(v) || 0)} FCFA`;
const number = (v, digits = 8) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(Number(v) || 0);
function formatDecimalString(value) {
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value ?? ''));
  if (!match) return '—';
  const [, sign, wholeDigits, fractionalDigits = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return '—';
  const allDigits = `${wholeDigits}${fractionalDigits}`;
  const decimalPosition = wholeDigits.length + exponent;
  const integer = decimalPosition <= 0
    ? '0'
    : decimalPosition >= allDigits.length
      ? `${allDigits}${'0'.repeat(decimalPosition - allDigits.length)}`
      : allDigits.slice(0, decimalPosition);
  const fraction = (decimalPosition <= 0
    ? `${'0'.repeat(-decimalPosition)}${allDigits}`
    : decimalPosition >= allDigits.length
      ? ''
      : allDigits.slice(decimalPosition)).replace(/0+$/, '');
  const whole = BigInt(`${sign}${integer || '0'}`);
  const grouped = new Intl.NumberFormat('fr-FR').format(whole);
  return `${grouped}${fraction ? `,${fraction}` : ''}`;
}
function safeExchangeRedirect(search) {
  const requested = new URLSearchParams(search).get('next') || '';
  if (!requested.startsWith('/acheter') && !requested.startsWith('/vendre')) return '/compte';
  if (requested.startsWith('//')) return '/compte';
  try {
    const destination = new URL(requested, window.location.origin);
    if (destination.origin !== window.location.origin) return '/compte';
    if (!['/acheter', '/vendre'].includes(destination.pathname)) return '/compte';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/compte';
  }
}
function createClientId() {
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes]
    .map((byte, index) => `${[4, 6, 8, 10].includes(index) ? '-' : ''}${byte.toString(16).padStart(2, '0')}`)
    .join('');
}
function getOrderIdempotencyKey(mode) {
  const storageKey = `dae-order:${mode}:idempotency`;
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (/^[0-9a-f-]{36}$/i.test(saved || '')) return saved;
    const created = createClientId();
    sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return createClientId();
  }
}
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
  if (!response.ok) {
    const error = new Error(data.error || `Erreur ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    let active = true;
    api('/api/account/me')
      .then((result) => { if (active) setCustomer(result.customer); })
      .catch(() => { if (active) setCustomer(null); })
      .finally(() => { if (active) setSessionChecked(true); });
    return () => { active = false; };
  }, []);
  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutError('');
    try {
      await api('/api/account/logout', { method: 'POST' });
      setCustomer(null);
      navigate('/');
    } catch {
      setLogoutError('Déconnexion impossible. Réessayez.');
      setLogoutBusy(false);
    }
  }
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
          {customer ? (
            <>
              <Link to="/compte" className="button button-primary">
                Mon compte
              </Link>
              <button type="button" className="nav-logout" onClick={logout} disabled={logoutBusy}>
                {logoutBusy ? 'Déconnexion…' : 'Déconnexion'}
              </button>
            </>
          ) : sessionChecked && (
            <>
              <Link to="/connexion" className="button button-quiet">Se connecter</Link>
              <Link to="/inscription" className="button button-primary">Créer un compte</Link>
            </>
          )}
          {logoutError && <span className="nav-session-error" role="status">{logoutError}</span>}
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
          <Link to="/compte">Espace client</Link>
          <Link to="/inscription">Créer un compte</Link>
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
function MarketHistoryChart({ assetId, markets }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    let active = true;
    setHistory({ loading: true, points: [] });
    const fetchHistory = async () => {
      try {
        const result = await api(`/api/markets/history/${encodeURIComponent(assetId)}`);
        if (active) setHistory(result);
      } catch (error) {
        if (active) setHistory({ error: error.message, points: [] });
      }
    };
    fetchHistory();
    const refresh = setInterval(fetchHistory, 5 * 60_000);
    return () => {
      active = false;
      clearInterval(refresh);
    };
  }, [assetId]);
  const points = history?.points || [];
  const coordinates = useMemo(() => {
    if (points.length < 2) return [];
    const prices = points.map((point) => Number(point.priceUsd));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const padding = (maxPrice - minPrice) * 0.08 || maxPrice * 0.001 || 0.001;
    const low = minPrice - padding;
    const range = maxPrice - minPrice + padding * 2;
    return points.map((point, index) => ({
      x: 42 + (index / (points.length - 1)) * 716,
      y: 196 - ((Number(point.priceUsd) - low) / range) * 160,
      ...point,
    }));
  }, [points]);
  const linePath = coordinates
    .map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
  const areaPath = coordinates.length ? `${linePath} L 758,214 L 42,214 Z` : '';
  const latestPrice = coordinates.length ? coordinates[coordinates.length - 1].priceUsd : null;
  const firstPrice = coordinates.length ? coordinates[0].priceUsd : null;
  const change = latestPrice && firstPrice ? ((latestPrice - firstPrice) / firstPrice) * 100 : null;
  const market = markets.find((item) => item.asset === assetId);
  const priceText = (value) =>
    value == null
      ? '—'
      : new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: value >= 1 ? 2 : 6,
        }).format(value);
  return (
    <section
      className="market-history-card"
      aria-label={`${assetId} historique des prix sur 24 heures`}
    >
      <div className="market-history-heading">
        <div>
          <span className="eyebrow plain">HISTORIQUE DE MARCHÉ · 24 H</span>
          <h3>
            {market?.name || assetId} <small>({assetId}/USD)</small>
          </h3>
        </div>
        <div className="market-history-current">
          <strong>{priceText(market?.priceUsd)}</strong>
          <span className={history?.stale ? 'history-source stale' : 'history-source'}>
            <i /> {history?.source || (history?.loading ? 'Chargement…' : 'Source indisponible')}
            {history?.stale ? ' · données anciennes' : ''}
          </span>
        </div>
      </div>
      <div className="market-history-chart-wrap">
        {coordinates.length > 1 ? (
          <>
            <div className="market-chart-axis market-chart-axis-top">
              {priceText(Math.max(...points.map((point) => point.priceUsd)))}
            </div>
            <div className="market-chart-axis market-chart-axis-bottom">
              {priceText(Math.min(...points.map((point) => point.priceUsd)))}
            </div>
            <svg
              className="market-history-svg"
              viewBox="0 0 800 240"
              role="img"
              aria-label={`${assetId}, cours horaire sur les dernières 24 heures`}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="market-history-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#a6d966" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#a6d966" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[46, 100, 154, 214].map((y) => (
                <line key={y} x1="42" x2="758" y1={y} y2={y} className="market-chart-gridline" />
              ))}
              <path d={areaPath} fill="url(#market-history-fill)" />
              <path d={linePath} className="market-chart-line" />
              {coordinates.length > 0 && (
                <circle
                  cx={coordinates.at(-1).x}
                  cy={coordinates.at(-1).y}
                  r="4"
                  className="market-chart-last-point"
                />
              )}
            </svg>
            <div className="market-chart-times">
              <span>
                {new Date(coordinates[0].timestamp).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span>Maintenant</span>
            </div>
          </>
        ) : (
          <div className="market-chart-empty">
            {history?.loading
              ? 'Récupération des observations horaires…'
              : history?.error || 'Historique temporairement indisponible.'}
          </div>
        )}
      </div>
      <div className="market-history-footer">
        <span>
          Prix agrégé indicatif en USD · observations horaires · source{' '}
          {history?.source || 'CoinPaprika'}.
        </span>
        <span className={change == null ? '' : change >= 0 ? 'positive' : 'negative'}>
          Variation observée{' '}
          {change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
        </span>
      </div>
    </section>
  );
}
function Home() {
  const [markets, setMarkets] = useState([]);
  const [updated, setUpdated] = useState('');
  const [marketState, setMarketState] = useState('loading');
  const [marketStale, setMarketStale] = useState(false);
  const [rates, setRates] = useState(null);
  const [query, setQuery] = useState('');
  const [marketTab, setMarketTab] = useState('Tous');
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dae-market-watchlist') || '[]');
      return Array.isArray(saved) ? saved.filter((asset) => assetsFallback.some((item) => item.id === asset)) : [];
    } catch { return []; }
  });
  const watchlistRef = useRef(watchlist);
  const [watchlistSyncEnabled, setWatchlistSyncEnabled] = useState(false);
  const [watchlistSyncState, setWatchlistSyncState] = useState('local');
  const [selectedChartAsset, setSelectedChartAsset] = useState('BTC');
  useEffect(() => {
    try { localStorage.setItem('dae-market-watchlist', JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);
  useEffect(() => {
    let active = true;
    api('/api/account/watchlist')
      .then(({ assets = [] }) => {
        if (!active) return;
        const merged = [...new Set([...assets, ...watchlistRef.current])];
        watchlistRef.current = merged;
        setWatchlist(merged);
        setWatchlistSyncEnabled(true);
      })
      .catch((error) => {
        if (active && error.status !== 401) setWatchlistSyncState('error');
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!watchlistSyncEnabled) return undefined;
    const timer = setTimeout(() => {
      setWatchlistSyncState('saving');
      api('/api/account/watchlist', {
        method: 'PUT',
        body: JSON.stringify({ assets: watchlist }),
      })
        .then(() => setWatchlistSyncState('saved'))
        .catch(() => setWatchlistSyncState('error'));
    }, 300);
    return () => clearTimeout(timer);
  }, [watchlist, watchlistSyncEnabled]);
  async function retryWatchlistSync() {
    setWatchlistSyncState('saving');
    try {
      if (!watchlistSyncEnabled) {
        const { assets = [] } = await api('/api/account/watchlist');
        const merged = [...new Set([...assets, ...watchlistRef.current])];
        watchlistRef.current = merged;
        setWatchlist(merged);
        setWatchlistSyncEnabled(true);
        return;
      }
      await api('/api/account/watchlist', {
        method: 'PUT',
        body: JSON.stringify({ assets: watchlistRef.current }),
      });
      setWatchlistSyncState('saved');
    } catch {
      setWatchlistSyncState('error');
    }
  }
  function toggleWatchlist(asset) {
    const current = watchlistRef.current;
    const updated = current.includes(asset)
      ? current.filter((item) => item !== asset)
      : [...current, asset];
    watchlistRef.current = updated;
    setWatchlist(updated);
  }
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [marketResult, ratesResult] = await Promise.allSettled([
        api('/api/markets'),
        api('/api/rates'),
      ]);
      if (!alive) return;
      if (marketResult.status === 'fulfilled') {
        const marketData = marketResult.value;
        setMarkets(marketData.markets || []);
        setUpdated(marketData.updatedAt
          ? new Date(marketData.updatedAt).toLocaleTimeString('fr-FR')
          : '');
        setMarketStale(Boolean(marketData.stale));
        setMarketState(marketData.stale ? 'stale' : 'ready');
      } else {
        setMarketState('unavailable');
        setMarketStale(true);
      }
      if (ratesResult.status === 'fulfilled') setRates(ratesResult.value);
    };
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const visibleMarkets = markets.filter((m) => {
    const matchQuery = `${m.asset} ${m.name}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchTab =
      marketTab === 'Tous' ||
      (marketTab === 'Populaires' && ['BTC', 'ETH', 'USDT'].includes(m.asset)) ||
      (marketTab === 'Stablecoins' && m.asset === 'USDT') ||
      (marketTab === 'Favoris' && watchlist.includes(m.asset));
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
                <i /> TARIF ACTUEL
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
            <span className={`updated${marketStale || marketState === 'unavailable' ? ' stale' : ''}`}>
              <i />
              {marketState === 'loading' && !updated
                ? 'Chargement des cotations…'
                : marketState === 'unavailable' && !updated
                  ? 'Cotations indisponibles'
                  : marketStale || marketState === 'unavailable'
                    ? `Données en cache · ${updated}`
                    : updated ? `Référence actualisée à ${updated}` : 'Cotations indisponibles'}
            </span>
          </div>
          <div className="market-toolbar">
            <div className="market-tabs" role="tablist" aria-label="Filtrer les actifs">
              {['Tous', 'Populaires', 'Stablecoins', 'Favoris'].map((tab) => (
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
          <div className={`market-watchlist-sync ${watchlistSyncState}`} aria-live="polite">
            <span>
              {watchlistSyncState === 'saving'
                ? 'Synchronisation des favoris…'
                : watchlistSyncState === 'saved'
                  ? 'Favoris synchronisés avec votre compte.'
                  : watchlistSyncState === 'error'
                    ? 'Échec de synchronisation. Les favoris restent enregistrés sur cet appareil.'
                    : 'Favoris enregistrés sur cet appareil.'}
            </span>
            {watchlistSyncState === 'error' && (
              <button type="button" onClick={retryWatchlistSync}>Réessayer</button>
            )}
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
                          <button
                            type="button"
                            className={watchlist.includes(m.asset) ? 'market-watch-toggle active' : 'market-watch-toggle'}
                            aria-label={watchlist.includes(m.asset) ? `Retirer ${m.asset} des favoris` : `Ajouter ${m.asset} aux favoris`}
                            aria-pressed={watchlist.includes(m.asset)}
                            onClick={() => toggleWatchlist(m.asset)}
                          >
                            {watchlist.includes(m.asset) ? '★' : '☆'}
                          </button>
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
              <p className="market-empty">
                {!markets.length && marketState === 'loading'
                  ? 'Chargement des cotations…'
                  : !markets.length
                    ? 'Les cotations de référence sont indisponibles pour le moment. Réessayez bientôt.'
                    : marketTab === 'Favoris' && !watchlist.length
                      ? 'Votre liste de favoris est vide. Ajoutez un actif avec l’étoile.'
                      : 'Aucun actif ne correspond à votre recherche.'}
              </p>
            )}
          </div>
          <div className="market-history-toolbar">
            <span>Historique indicatif</span>
            <label>
              <span>Actif</span>
              <select
                value={selectedChartAsset}
                onChange={(event) => setSelectedChartAsset(event.target.value)}
              >
                {assetsFallback.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.id} · {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <MarketHistoryChart assetId={selectedChartAsset} markets={markets} />
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
  const navigate = useNavigate();
  const [idempotencyKey] = useState(() => getOrderIdempotencyKey(mode));
  const [config, setConfig] = useState(null),
    [rates, setRates] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [accountChecked, setAccountChecked] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [asset, setAsset] = useState(
      () => new URLSearchParams(location.search).get('asset') || 'USDT',
    ),
    [network, setNetwork] = useState(''),
    [cryptoTransferMethod, setCryptoTransferMethod] = useState('network'),
    [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [step, setStep] = useState(1),
    [operator, setOperator] = useState('mtn'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState({
    wallet: '',
    binancePayId: '',
    phone: '',
    recipientName: '',
    proof: '',
    consent: false,
  });
  useEffect(() => {
    Promise.allSettled([api('/api/config'), api('/api/rates'), api('/api/account/me')])
      .then(([configResult, ratesResult, accountResult]) => {
        if (configResult.status === 'fulfilled') setConfig(configResult.value);
        if (ratesResult.status === 'fulfilled') setRates(ratesResult.value);
        if (accountResult.status === 'fulfilled') setCustomer(accountResult.value.customer);
        else if (accountResult.reason.status !== 401) setAccountError(accountResult.reason.message);
        setAccountChecked(true);
        const failures = [configResult, ratesResult].filter((item) => item.status === 'rejected');
        if (failures.length) setError(failures[0].reason.message);
      });
  }, []);
  useEffect(() => {
    if (!customer) return undefined;
    let active = true;
    let pendingKey = '';
    try {
      pendingKey = sessionStorage.getItem(`dae-order:${mode}:idempotency`) || '';
    } catch {
      return undefined;
    }
    if (!pendingKey) return undefined;
    api(`/api/orders/idempotency/${encodeURIComponent(pendingKey)}`)
      .then((order) => {
        if (!active) return;
        try {
          sessionStorage.removeItem(`dae-order:${mode}:idempotency`);
        } catch {
          // Storage is optional; the API lookup already recovered the order.
        }
        navigate(`/suivi?ref=${encodeURIComponent(order.ref)}`, { replace: true });
      })
      .catch((requestError) => {
        if (active && requestError.status !== 404) setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, [customer, mode, navigate]);
  useEffect(() => {
    if (!amount.trim()) {
      setQuote(null);
      setQuoteError('');
      setQuoteLoading(false);
      return undefined;
    }
    let active = true;
    setQuote(null);
    setQuoteError('');
    setQuoteExpired(false);
    setQuoteLoading(true);
    const timer = setTimeout(() => {
      api('/api/orders/quote', {
        method: 'POST',
        body: JSON.stringify({ mode, asset, amount }),
      })
        .then((result) => {
          if (active) setQuote(result);
        })
        .catch((requestError) => {
          if (active) setQuoteError(requestError.message);
        })
        .finally(() => {
          if (active) setQuoteLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [amount, mode, asset, quoteRevision]);
  useEffect(() => {
    if (!quote?.quoteExpiresAt) return undefined;
    const remaining = new Date(quote.quoteExpiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setQuoteExpired(true);
      return undefined;
    }
    const timer = setTimeout(() => setQuoteExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [quote]);
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
  function refreshQuote() {
    setStep(1);
    setQuote(null);
    setQuoteExpired(false);
    setQuoteRevision((current) => current + 1);
  }
  function changeCryptoTransferMethod(method) {
    setCryptoTransferMethod(method);
    setNetwork(method === 'binance_pay' ? 'BINANCE_PAY' : '');
  }
  function advance() {
    setError('');
    if (!customer) return setError('Connectez-vous avec un compte vérifié pour continuer.');
    if (rates?.orderServiceAvailable === false) {
      return setError(
        'Les demandes de change sont indisponibles : la base exige MongoDB en replica set ou cluster compatible.',
      );
    }
    if (step === 1) {
      if (quoteExpired) {
        refreshQuote();
        return setError('La cotation a expiré. Vérifiez le nouveau montant avant de continuer.');
      }
      if (!quote || !quote.quoteToken || quoteLoading || (cryptoTransferMethod === 'network' && !network))
        return setError(quoteError || 'Choisissez un mode de transfert et un montant valide.');
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
    if (!quote?.quoteToken || quoteExpired) {
      refreshQuote();
      setError('La cotation a expiré. Vérifiez le nouveau montant avant de confirmer.');
      return;
    }
    if (!quote?.quoteToken || quoteExpired) {
      setError('Cette cotation a expiré. Modifiez puis ressaisissez le montant pour obtenir une nouvelle cotation.');
      setStep(1);
      return;
    }
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
          amount,
          quoteToken: quote.quoteToken,
          idempotencyKey,
          network: cryptoTransferMethod === 'binance_pay' ? 'BINANCE_PAY' : network,
          cryptoTransferMethod,
          operator,
          phone: form.phone,
          recipientName: mode === 'sell' ? form.recipientName : undefined,
          wallet: mode === 'buy' && cryptoTransferMethod === 'network' ? form.wallet : undefined,
          binancePayId:
            mode === 'buy' && cryptoTransferMethod === 'binance_pay'
              ? form.binancePayId
              : undefined,
          proof: form.proof,
          proofImage,
        }),
      });
      try {
        sessionStorage.removeItem(`dae-order:${mode}:idempotency`);
      } catch {
        // Storage is optional; the server remains authoritative for idempotency.
      }
      navigate(
        `/attente?ref=${encodeURIComponent(result.ref)}${result.notificationSent ? '' : '&notification=failed'}`,
      );
    } catch (err) {
      if (err.data?.orderRef) {
        navigate(`/attente?ref=${encodeURIComponent(err.data.orderRef)}`);
        return;
      }
      setError(err.message);
      if (err.status === 409 || /cotation.*expir/i.test(err.message)) refreshQuote();
      setBusy(false);
    }
  }
  const ready = config && rates;
  if (!accountChecked) {
    return (
      <Shell>
        <main className="page-wrap narrow">
          <div className="loading">Vérification de votre compte…</div>
        </main>
      </Shell>
    );
  }
  if (!customer) {
    const returnPath = `${location.pathname}${location.search}`;
    const loginPath = `/connexion?next=${encodeURIComponent(returnPath)}`;
    return (
      <Shell>
        <main className="page-wrap narrow">
          <section className="tracking-card customer-auth-gate">
            <span className="eyebrow plain">COMPTE CLIENT DAE</span>
            <h1>{mode === 'buy' ? 'Connectez-vous pour acheter' : 'Connectez-vous pour vendre'}</h1>
            <p>
              Les demandes de change sont réservées aux comptes actifs dont l’e-mail et le numéro
              de téléphone ont été vérifiés. La connexion nécessite aussi les codes de sécurité
              envoyés sur ces deux canaux.
            </p>
            <Notice>{accountError}</Notice>
            <div className="form-actions">
              <Link to={loginPath} className="button button-primary">
                Se connecter
              </Link>
              <Link
                to={`/inscription?next=${encodeURIComponent(returnPath)}`}
                className="button button-outline"
              >
                Créer un compte
              </Link>
            </div>
          </section>
        </main>
      </Shell>
    );
  }
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
            {rates?.orderServiceAvailable === false && (
              <Notice>
                Les commandes sont temporairement indisponibles. La base MongoDB doit prendre en
                charge les transactions multi-documents pour enregistrer les changements et leur
                historique ensemble.
              </Notice>
            )}
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
                      {mode === 'sell' && !config.binancePayId && (
                        <p className="transfer-unavailable" role="status">
                          L’UID Binance Pay de DAE n’est pas encore renseigné. L’équipe doit
                          l’ajouter dans la <Link to="/admin">configuration admin</Link> pour
                          activer cette option.
                        </p>
                      )}
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
                      <small>Maximum 8 décimales. Le total est calculé par DAE et arrondi au FCFA.</small>
                    </label>
                    <div className="quote-box">
                      <div>
                        <span>{mode === 'buy' ? 'Vous recevrez environ' : 'Valeur estimée'}</span>
                        <strong>{quote ? `${formatDecimalString(quote.amountCrypto)} ${asset}` : '—'}</strong>
                      </div>
                      <div>
                        <span>{mode === 'buy' ? 'Total à payer' : 'Vous recevrez environ'}</span>
                        <strong>{quote ? money(quote.xaf) : '— FCFA'}</strong>
                      </div>
                      <small>
                        1 USDT ={' '}
                        {money(quote?.rate ?? (mode === 'buy' ? rates.buyRate : rates.sellRate))}
                        {quoteLoading
                          ? ' · calcul de la cotation…'
                          : quoteExpired
                            ? ' · cotation expirée'
                            : quote
                              ? ` · valable jusqu’à ${new Date(quote.quoteExpiresAt).toLocaleTimeString('fr-FR')}`
                              : quoteError ? ` · ${quoteError}` : ''}
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
                      {['mtn', 'airtel'].map((op) => {
                        const operatorAvailable =
                          mode === 'sell' || Boolean(config?.paymentNumbers?.[op]);
                        return (
                          <label
                            key={op}
                            className={`${operator === op ? 'radio-card chosen' : 'radio-card'}${operatorAvailable ? '' : ' unavailable'}`}
                          >
                            <input
                              type="radio"
                              name="operator"
                              value={op}
                              checked={operator === op}
                              disabled={!operatorAvailable}
                              onChange={() => setOperator(op)}
                            />
                            <span className={`operator-dot ${op}`}>
                              {op === 'mtn' ? 'M' : 'A'}
                            </span>
                            {op === 'mtn' ? 'MTN Money' : 'Airtel Money'}
                          </label>
                        );
                      })}
                    </fieldset>
                    {mode === 'buy' &&
                      !config?.paymentNumbers?.mtn &&
                      !config?.paymentNumbers?.airtel && (
                        <p className="transfer-unavailable" role="status">
                          Aucun numéro Mobile Money n’est configuré pour recevoir le paiement.
                          Contactez l’assistance DAE.
                        </p>
                      )}
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
                    <div className="payment-instructions">
                      <strong>E-mail du compte vérifié</strong>
                      <p>{customer.email}</p>
                    </div>
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
                          {quote ? formatDecimalString(quote.amountCrypto) : '—'} {asset}
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
                    <button
                      className="button button-primary full"
                      disabled={busy || rates?.orderServiceAvailable === false}
                    >
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
  const navigate = useNavigate();
  const route = useLocation();
  const isPendingPage = location.pathname.replace(/\/$/, '') === '/attente';
  const initialRef = new URLSearchParams(route.search).get('ref') || '';
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
        navigate(`/suivi?ref=${encodeURIComponent(value)}`, { replace: true });
      } catch (e) {
        setOrder(null);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [ref, navigate],
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
                    {formatDecimalString(String(order.amountCrypto ?? order.amountUsdt ?? ''))} {order.asset}
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
function AccountAccess({ initialMode = 'login' }) {
  const navigate = useNavigate();
  const route = useLocation();
  const registerMode = initialMode === 'register';
  const [stage, setStage] = useState(1);
  const [features, setFeatures] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    emailCode: '',
    phoneCode: '',
    acceptTerms: false,
    acceptPrivacy: false,
  });
  useEffect(() => {
    api('/api/account/features')
      .then(setFeatures)
      .catch((requestError) => setError(requestError.message));
  }, []);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (registerMode && stage === 1) {
        if (form.password !== form.confirmPassword)
          throw Error('Les mots de passe ne correspondent pas.');
        await api('/api/account/register', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        setStage(2);
        setMessage('Codes envoyés. Vérifie ton e-mail et ton téléphone.');
      } else if (registerMode) {
        await api('/api/account/verify', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        navigate(safeExchangeRedirect(route.search));
      } else if (stage === 1) {
        const result = await api('/api/account/login', {
          method: 'POST',
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        setChallengeId(result.challengeId);
        setStage(2);
        setMessage(result.message);
      } else {
        await api('/api/account/login/verify', {
          method: 'POST',
          body: JSON.stringify({
            challengeId,
            emailCode: form.emailCode,
            phoneCode: form.phoneCode,
          }),
        });
        navigate(safeExchangeRedirect(route.search));
      }
    } catch (requestError) {
      setError(requestError.message);
      if (registerMode && stage === 1 && requestError.data?.accountCreated) {
        setStage(2);
        setMessage(
          'Compte créé. Un canal de vérification est indisponible : réessaie l’envoi des codes.',
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function resendCodes() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await api('/api/account/resend-code', {
        method: 'POST',
        body: JSON.stringify({ email: form.email, phone: form.phone }),
      });
      setMessage('Si le compte attend une vérification, de nouveaux codes ont été envoyés.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  const registrationReady = features?.accounts?.registration;
  return (
    <Shell>
      <main className="account-access-wrap">
        <section className="account-access-card">
          <div className="account-access-brand">
            <img src="/images/dae-logo.png" alt="DAE Crypto" />
            <span>PLATEFORME DAE</span>
          </div>
          <div className="account-access-heading">
            <span className="eyebrow plain">
              {registerMode ? 'NOUVEAU COMPTE' : 'ESPACE SÉCURISÉ'}
            </span>
            <h1>
              {stage === 2
                ? registerMode
                  ? 'Vérifions tes coordonnées.'
                  : 'Confirme cette connexion.'
                : registerMode
                  ? 'Commence avec DAE.'
                  : 'Ravi de te revoir.'}
            </h1>
            <p>
              {stage === 2
                ? 'Entre les codes à six chiffres reçus séparément par e-mail et SMS.'
                : registerMode
                  ? 'Crée ton accès personnel. Tes coordonnées seront vérifiées avant toute activité du compte.'
                  : 'Connecte-toi avec ton e-mail, puis confirme avec les codes de sécurité.'}
            </p>
          </div>
          {registerMode && !registrationReady && stage === 1 && (
            <div className="account-gate" role="status">
              <strong>Les inscriptions ne sont pas encore activées.</strong>
              <span>
                DAE doit configurer l’e-mail/SMS et publier les conditions et la politique de
                confidentialité approuvées avant d’ouvrir l’inscription.
              </span>
            </div>
          )}
          <form className="account-access-form" onSubmit={submit}>
            {stage === 1 && registerMode && (
              <div className="account-name-fields">
                <label className="field-label">
                  Prénom
                  <input
                    required
                    minLength="2"
                    maxLength="80"
                    autoComplete="given-name"
                    value={form.firstName}
                    onChange={(e) => update('firstName', e.target.value)}
                  />
                </label>
                <label className="field-label">
                  Nom
                  <input
                    required
                    minLength="2"
                    maxLength="80"
                    autoComplete="family-name"
                    value={form.lastName}
                    onChange={(e) => update('lastName', e.target.value)}
                  />
                </label>
              </div>
            )}
            {(stage === 1 || registerMode) && (
              <>
                <label className="field-label">
                  Adresse e-mail
                  <input
                    required
                    type="email"
                    maxLength="254"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                  />
                </label>
                {registerMode && stage === 1 && (
                  <label className="field-label">
                    Téléphone avec indicatif international
                    <input
                      required
                      type="tel"
                      placeholder="+242 …"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                    />
                  </label>
                )}
                <label className="field-label">
                  Mot de passe
                  <input
                    required
                    type="password"
                    minLength="12"
                    maxLength="128"
                    autoComplete={registerMode ? 'new-password' : 'current-password'}
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                  />
                  {registerMode && <small>12 caractères minimum.</small>}
                </label>
                {!registerMode && stage === 1 && features && (
                  <div className="account-recovery-link">
                    {features?.accounts?.recovery ? (
                      <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
                    ) : (
                      <span>
                        Récupération indisponible : vérification e-mail/SMS non configurée.
                      </span>
                    )}
                  </div>
                )}
                {registerMode && stage === 1 && (
                  <label className="field-label">
                    Confirmer le mot de passe
                    <input
                      required
                      type="password"
                      minLength="12"
                      maxLength="128"
                      autoComplete="new-password"
                      value={form.confirmPassword}
                      onChange={(e) => update('confirmPassword', e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {stage === 2 && (
              <>
                {registerMode && (
                  <label className="field-label">
                    Téléphone du compte
                    <input
                      required
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                    />
                  </label>
                )}
                <label className="field-label">
                  Code reçu par e-mail
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    minLength="6"
                    maxLength="6"
                    autoComplete="one-time-code"
                    value={form.emailCode}
                    onChange={(e) => update('emailCode', e.target.value)}
                  />
                </label>
                <label className="field-label">
                  Code reçu par SMS
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    minLength="6"
                    maxLength="6"
                    value={form.phoneCode}
                    onChange={(e) => update('phoneCode', e.target.value)}
                  />
                </label>
              </>
            )}
            {registerMode && stage === 1 && (
              <div className="account-consents">
                <label>
                  <input
                    type="checkbox"
                    required
                    checked={form.acceptTerms}
                    onChange={(e) => update('acceptTerms', e.target.checked)}
                  />{' '}
                  J’accepte les conditions d’utilisation de DAE
                  {features?.accounts?.policies?.termsUrl && (
                    <a href={features.accounts.policies.termsUrl} target="_blank" rel="noreferrer">
                      {' '}
                      Lire les conditions
                    </a>
                  )}
                  .
                </label>
                <label>
                  <input
                    type="checkbox"
                    required
                    checked={form.acceptPrivacy}
                    onChange={(e) => update('acceptPrivacy', e.target.checked)}
                  />{' '}
                  J’accepte le traitement de mes coordonnées selon la politique de confidentialité
                  {features?.accounts?.policies?.privacyUrl && (
                    <a
                      href={features.accounts.policies.privacyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {' '}
                      Lire la politique
                    </a>
                  )}
                  .
                </label>
              </div>
            )}
            {error && <Notice>{error}</Notice>}
            {message && <Notice type="success">{message}</Notice>}
            {registerMode && stage === 1 && !registrationReady ? (
              <button className="button button-primary full" disabled>
                Inscriptions indisponibles
              </button>
            ) : (
              <button className="button button-primary full" disabled={busy}>
                {busy
                  ? 'Patiente…'
                  : stage === 2
                    ? 'Vérifier et continuer'
                    : registerMode
                      ? 'Créer mon compte'
                      : 'Continuer'}
              </button>
            )}
            {stage === 2 && (
              <button
                type="button"
                className="text-button account-resend"
                disabled={busy}
                onClick={resendCodes}
              >
                Renvoyer les codes
              </button>
            )}
          </form>
          <div className="account-access-switch">
            {registerMode ? 'Tu as déjà un compte ?' : 'Première visite ?'}{' '}
            <Link to={registerMode ? '/connexion' : '/inscription'}>
              {registerMode ? 'Se connecter' : 'Créer un compte'}
            </Link>
          </div>
          <Link className="account-back" to="/">
            ← Retour à DAE
          </Link>
        </section>
        <aside className="account-access-aside">
          <span className="account-aside-mark">
            DAE<span>.</span>
          </span>
          <p className="eyebrow">VOTRE ESPACE CRYPTO</p>
          <h2>Un compte clair. Des opérations sous contrôle.</h2>
          <div className="account-security-points">
            <p>
              <b>01</b>
              <span>
                <strong>Double vérification</strong>
                <small>E-mail et téléphone confirmés séparément.</small>
              </span>
            </p>
            <p>
              <b>02</b>
              <span>
                <strong>Identité vérifiée avant les fonds</strong>
                <small>
                  Les fonctions de garde restent fermées tant que les contrôles ne sont pas prêts.
                </small>
              </span>
            </p>
          </div>
        </aside>
      </main>
    </Shell>
  );
}
function PasswordRecovery() {
  const [stage, setStage] = useState(1);
  const [features, setFeatures] = useState(null);
  const [form, setForm] = useState({
    email: '',
    emailCode: '',
    phoneCode: '',
    password: '',
    confirmation: '',
  });
  const [challengeId, setChallengeId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/account/features')
      .then(setFeatures)
      .catch((requestError) => setError(requestError.message));
  }, []);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (stage === 1) {
        const result = await api('/api/account/password/forgot', {
          method: 'POST',
          body: JSON.stringify({ email: form.email }),
        });
        setChallengeId(result.challengeId);
        setStage(2);
        setMessage(result.message);
      } else {
        if (form.password !== form.confirmation)
          throw Error('Les mots de passe ne correspondent pas.');
        await api('/api/account/password/reset', {
          method: 'POST',
          body: JSON.stringify({
            challengeId,
            emailCode: form.emailCode,
            phoneCode: form.phoneCode,
            password: form.password,
          }),
        });
        setStage(3);
        setMessage('Mot de passe modifié. Tu peux maintenant te connecter.');
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <main className="account-access-wrap recovery-wrap">
        <section className="account-access-card">
          <div className="account-access-brand">
            <img src="/images/dae-logo.png" alt="DAE Crypto" />
            <span>RÉCUPÉRATION SÉCURISÉE</span>
          </div>
          <div className="account-access-heading">
            <span className="eyebrow plain">ACCÈS AU COMPTE</span>
            <h1>
              {stage === 3
                ? 'Accès restauré.'
                : stage === 1
                  ? 'Réinitialise ton mot de passe.'
                  : 'Confirme ton identité.'}
            </h1>
            <p>
              {stage === 1
                ? 'Nous enverrons des codes séparés à l’adresse e-mail et au téléphone associés au compte.'
                : stage === 2
                  ? 'Saisis les deux codes reçus, puis choisis un nouveau mot de passe.'
                  : 'Toutes les sessions ouvertes ont été fermées.'}
            </p>
          </div>
          {!features?.accounts?.recovery && stage === 1 && (
            <div className="account-gate" role="status">
              <strong>Récupération indisponible.</strong>
              <span>
                Les services de vérification e-mail/SMS doivent être configurés pour sécuriser cette
                opération.
              </span>
            </div>
          )}
          {stage < 3 && (
            <form className="account-access-form" onSubmit={submit}>
              {stage === 1 ? (
                <label className="field-label">
                  Adresse e-mail du compte
                  <input
                    required
                    type="email"
                    maxLength="254"
                    autoComplete="email"
                    value={form.email}
                    onChange={(event) => update('email', event.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label className="field-label">
                    Code reçu par e-mail
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      minLength="6"
                      maxLength="6"
                      autoComplete="one-time-code"
                      value={form.emailCode}
                      onChange={(event) => update('emailCode', event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Code reçu par SMS
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      minLength="6"
                      maxLength="6"
                      value={form.phoneCode}
                      onChange={(event) => update('phoneCode', event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Nouveau mot de passe
                    <input
                      required
                      type="password"
                      minLength="12"
                      maxLength="128"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(event) => update('password', event.target.value)}
                    />
                    <small>12 caractères minimum.</small>
                  </label>
                  <label className="field-label">
                    Confirmer le nouveau mot de passe
                    <input
                      required
                      type="password"
                      minLength="12"
                      maxLength="128"
                      autoComplete="new-password"
                      value={form.confirmation}
                      onChange={(event) => update('confirmation', event.target.value)}
                    />
                  </label>
                </>
              )}
              {error && <Notice>{error}</Notice>}
              {message && <Notice type="success">{message}</Notice>}
              <button
                className="button button-primary full"
                disabled={busy || (stage === 1 && !features?.accounts?.recovery)}
              >
                {busy
                  ? 'Patiente…'
                  : stage === 1
                    ? 'Envoyer les codes'
                    : 'Modifier le mot de passe'}
              </button>
            </form>
          )}
          {stage === 3 && <Notice type="success">{message}</Notice>}
          <div className="account-access-switch">
            <Link to="/connexion">← Retour à la connexion</Link>
          </div>
        </section>
      </main>
    </Shell>
  );
}
function CustomerFundingHistory({ type }) {
  const [activities, setActivities] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const busy = useRef(false);
  const load = useCallback(async (nextCursor = null) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ type });
      if (nextCursor) query.set('cursor', nextCursor);
      const result = await api(`/api/account/funding-activity?${query}`);
      setActivities((current) => {
        const merged = nextCursor ? [...current, ...(result.activities || [])] : result.activities || [];
        return [...new Map(merged.map((item) => [item.id, item])).values()];
      });
      setCursor(result.pagination?.nextCursor || null);
      setHasMore(Boolean(result.pagination?.hasMore));
    } catch (requestError) {
      setError(requestError.message || 'Historique indisponible.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [type]);
  useEffect(() => { load(); }, [load]);
  const title = { deposit: 'Historique des dépôts', withdrawal: 'Historique des retraits', staking: 'Historique du staking' }[type];
  const fundingStatusNames = {
    detected: 'Détecté',
    confirming: 'Confirmations en cours',
    compliance_review: 'En attente de vérification',
    credited: 'Crédité',
    requested: 'Demandé',
    approved: 'Approuvé',
    queued: 'En file de traitement',
    broadcast: 'Envoyé sur BSC',
    completed: 'Terminé',
    failed: 'Échoué',
    rejected: 'Refusé',
    cancelled: 'Annulé',
  };
  return (
    <section className="customer-order-history customer-funding-history">
      <div className="customer-order-history-heading"><div><span className="eyebrow plain">ACTIVITÉS DU COMPTE</span><h2>{title}</h2></div></div>
      {error && <p className="customer-history-pagination" role="status">{error}</p>}
      {!activities.length && !loading && !error && <p className="customer-history-pagination">Aucune opération enregistrée.</p>}
      {activities.map((item) => (
        <article className="funding-activity-row" key={item.id}>
          <div><strong>{item.asset} · {item.network}</strong><small>{new Date(item.createdAt).toLocaleString('fr-FR')} · {fundingStatusNames[item.status] || item.status}</small></div>
          <strong>{item.amount === null ? 'Montant à confirmer' : `${formatDecimalString(item.amount)} ${item.asset}`}</strong>
          {item.reference && <small className="funding-reference">Tx · {item.reference}</small>}
        </article>
      ))}
      <div className="customer-history-pagination"><span>{loading ? 'Chargement…' : type === 'staking' ? 'Staking désactivé' : 'Réseau BNB Smart Chain · historique du compte'}</span>{hasMore && <button className="button button-secondary" disabled={loading} onClick={() => load(cursor)}>Charger la suite</button>}</div>
    </section>
  );
}

function CustomerPortal() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [features, setFeatures] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [balances, setBalances] = useState([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState('');
  const [orders, setOrders] = useState([]);
  const [orderPagination, setOrderPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    pages: 1,
  });
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistoryError, setOrderHistoryError] = useState('');
  const orderHistoryRequest = useRef(false);
  const [marketSnapshot, setMarketSnapshot] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsMessage, setSessionsMessage] = useState('');
  const [sessionsError, setSessionsError] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalDestination, setWithdrawalDestination] = useState('');
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [withdrawalMessage, setWithdrawalMessage] = useState('');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [withdrawalRefresh, setWithdrawalRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const path = location.pathname.replace(/\/$/, '') || '/compte';
  useEffect(() => {
    Promise.all([
      api('/api/account/me'),
      api('/api/account/features'),
      api('/api/account/wallets'),
      api('/api/account/orders'),
    ])
      .then(([profile, serviceFeatures, walletResponse, orderResponse]) => {
        setCustomer(profile.customer);
        setFeatures(serviceFeatures);
        setWallets(walletResponse.wallets || []);
        setOrders(orderResponse.orders || []);
        setOrderPagination(orderResponse.pagination || { page: 1, pageSize: 20, total: 0, pages: 1 });
      })
      .catch(() => navigate('/connexion', { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);
  useEffect(() => {
    if (path !== '/compte') return undefined;
    let mounted = true;
    const refreshMarkets = async () => {
      try {
        const snapshot = await api('/api/markets');
        if (mounted) setMarketSnapshot(snapshot);
      } catch (requestError) {
        if (mounted) setMarketSnapshot({ error: requestError.message, markets: [] });
      }
    };
    refreshMarkets();
    const interval = setInterval(refreshMarkets, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [path]);
  useEffect(() => {
    if (path !== '/portefeuille') return undefined;
    let active = true;
    setBalancesLoading(true);
    setBalancesError('');
    api('/api/account/balances')
      .then((result) => {
        if (active) setBalances(result.balances || []);
      })
      .catch((error) => {
        if (active) setBalancesError(error.message);
      })
      .finally(() => {
        if (active) setBalancesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    if (path !== '/securite') return undefined;
    let active = true;
    setSessionsLoading(true);
    api('/api/account/sessions')
      .then((result) => {
        if (active) {
          setSessions(result.sessions || []);
          setActiveSessionCount(result.activeSessionCount || 0);
        }
      })
      .catch((error) => {
        if (active) setSessionsError(error.message);
      })
      .finally(() => {
        if (active) setSessionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function revokeOtherSessions() {
    setSessionsBusy(true);
    setSessionsError('');
    setSessionsMessage('');
    try {
      const result = await api('/api/account/sessions/revoke-others', {
        method: 'POST',
        body: '{}',
      });
      setSessionsMessage(
        result.revokedCount
          ? `${result.revokedCount} session${result.revokedCount > 1 ? 's' : ''} déconnectée${result.revokedCount > 1 ? 's' : ''}.`
          : 'Aucune autre session active à déconnecter.',
      );
      const updated = await api('/api/account/sessions');
      setSessions(updated.sessions || []);
      setActiveSessionCount(updated.activeSessionCount || 0);
    } catch (error) {
      setSessionsError(error.message);
    } finally {
      setSessionsBusy(false);
    }
  }
  async function logout() {
    try {
      await api('/api/account/logout', { method: 'POST', body: '{}' });
    } finally {
      navigate('/connexion');
    }
  }
  async function submitBscWithdrawal(event) {
    event.preventDefault();
    setWithdrawalBusy(true);
    setWithdrawalError('');
    setWithdrawalMessage('');
    try {
      const result = await api('/api/account/withdrawals', {
        method: 'POST',
        headers: { 'Idempotency-Key': createClientId() },
        body: JSON.stringify({ amount: withdrawalAmount, destination: withdrawalDestination }),
      });
      setWithdrawalMessage(`Retrait créé · ${result.withdrawal.status} · référence ${result.withdrawal.id}`);
      setWithdrawalAmount('');
      setWithdrawalRefresh((version) => version + 1);
    } catch (error) {
      setWithdrawalError(error.message);
    } finally {
      setWithdrawalBusy(false);
    }
  }
  async function loadMoreOrders() {
    if (
      orderHistoryRequest.current ||
      orderHistoryLoading ||
      orderPagination.page >= orderPagination.pages
    )
      return;
    orderHistoryRequest.current = true;
    setOrderHistoryLoading(true);
    setOrderHistoryError('');
    try {
      const nextPage = orderPagination.page + 1;
      const result = await api(`/api/account/orders?page=${nextPage}`);
      setOrders((current) => {
        const knownRefs = new Set(current.map((order) => order.ref));
        return [...current, ...(result.orders || []).filter((order) => !knownRefs.has(order.ref))];
      });
      setOrderPagination(result.pagination || orderPagination);
    } catch (error) {
      setOrderHistoryError(error.message);
    } finally {
      orderHistoryRequest.current = false;
      setOrderHistoryLoading(false);
    }
  }
  const sections = [
    ['/compte', 'Aperçu', '⌂'],
    ['/portefeuille', 'Portefeuille', '◈'],
    ['/depot', 'Dépôt', '↓'],
    ['/retrait', 'Retrait', '↑'],
    ['/staking', 'Staking', '◇'],
    ['/verification', 'Vérification', '✓'],
    ['/securite', 'Sécurité', '⌑'],
  ];
  const titles = {
    '/compte': 'Vue d’ensemble',
    '/portefeuille': 'Mon portefeuille',
    '/depot': 'Déposer des actifs',
    '/retrait': 'Retirer des actifs',
    '/staking': 'Staking',
    '/verification': 'Vérification du compte',
    '/securite': 'Sécurité du compte',
  };
  if (loading || !customer) {
    return <main className="customer-loading">Chargement de ton espace sécurisé…</main>;
  }
  return (
    <div className="customer-app">
      <aside className="customer-sidebar">
        <Link to="/" className="customer-brand">
          <img src="/images/dae-logo.png" alt="DAE Crypto" />
        </Link>
        <span className="customer-menu-label">ESPACE PERSONNEL</span>
        <nav>
          {sections.map(([href, label, icon]) => (
            <Link
              key={href}
              to={href}
              className={path === href ? 'customer-nav active' : 'customer-nav'}
            >
              <span>{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="customer-sidebar-bottom">
          <Link to="/#marches">Explorer les marchés ↗</Link>
          <button onClick={logout}>Déconnexion</button>
        </div>
      </aside>
      <main className="customer-main">
        <header className="customer-topbar">
          <div>
            <span>DAE</span>
            <i>/</i>
            <strong>{titles[path] || 'Espace client'}</strong>
          </div>
          <div className="customer-user-chip">
            <span>
              {customer.firstName.slice(0, 1)}
              {customer.lastName.slice(0, 1)}
            </span>
            <b>
              {customer.firstName} {customer.lastName}
            </b>
          </div>
        </header>
        <div className="customer-content">
          <div className="customer-page-heading">
            <div>
              <span className="eyebrow plain">ESPACE CLIENT</span>
              <h1>{titles[path] || 'Espace client'}</h1>
            </div>
            <span className={`customer-status status-${customer.status}`}>
              {customer.status === 'active' ? 'Compte actif' : customer.status}
            </span>
          </div>
          {path === '/compte' && (
            <>
              <section className="customer-welcome">
                <div>
                  <span>BIENVENUE SUR DAE</span>
                  <h2>Bonjour {customer.firstName},</h2>
                  <p>Voici l’état de ton compte et les services actuellement disponibles.</p>
                </div>
                <span className="welcome-monogram">{customer.firstName.slice(0, 1)}</span>
              </section>
              <section className="customer-market-overview">
                <div className="customer-market-heading">
                  <div>
                    <span className="eyebrow plain">MARCHÉS</span>
                    <h2>Suivre les actifs</h2>
                  </div>
                  <span
                    className={
                      marketSnapshot?.stale ? 'market-feed-state stale' : 'market-feed-state'
                    }
                  >
                    <i />
                    {marketSnapshot?.updatedAt
                      ? `${marketSnapshot.stale ? 'Cours en cache · ' : ''}${marketSnapshot.source} · ${new Date(marketSnapshot.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                      : marketSnapshot?.error
                        ? 'Cours indisponibles'
                        : 'Chargement des cours…'}
                  </span>
                </div>
                {marketSnapshot?.markets?.length ? (
                  <div className="customer-market-list">
                    {marketSnapshot.markets.map((market) => {
                      const change = Number(market.change24h);
                      const price = Number(market.priceUsd);
                      const formattedPrice = new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: price >= 1 ? 2 : 6,
                      }).format(price);
                      return (
                        <article className="customer-market-row" key={market.asset}>
                          <span
                            className={`customer-market-icon icon-${market.asset.toLowerCase()}`}
                          >
                            {market.asset.slice(0, 1)}
                          </span>
                          <div className="customer-market-name">
                            <strong>{market.asset}</strong>
                            <small>{market.name}</small>
                          </div>
                          <strong className="customer-market-price">{formattedPrice}</strong>
                          <span
                            className={`customer-market-change ${change < 0 ? 'negative' : 'positive'}`}
                          >
                            {Number.isFinite(change)
                              ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%`
                              : '—'}
                          </span>
                          <div className="customer-market-actions">
                            <Link to={`/acheter?asset=${encodeURIComponent(market.asset)}`}>
                              Acheter
                            </Link>
                            <Link to={`/vendre?asset=${encodeURIComponent(market.asset)}`}>
                              Vendre
                            </Link>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="customer-market-empty">
                    {marketSnapshot?.error ||
                      'Les cours de référence apparaîtront ici dès leur chargement.'}
                  </p>
                )}
                <small className="customer-market-disclaimer">
                  Cours indicatifs en USD. Le taux de conversion DAE en FCFA est confirmé avant
                  chaque commande.
                </small>
              </section>
              <div className="customer-status-grid">
                <article>
                  <span>Vérification e-mail</span>
                  <strong className="verified-value">
                    {customer.emailVerified ? 'Confirmée' : 'À confirmer'}
                  </strong>
                  <small>{customer.email}</small>
                </article>
                <article>
                  <span>Vérification téléphone</span>
                  <strong className="verified-value">
                    {customer.phoneVerified ? 'Confirmée' : 'À confirmer'}
                  </strong>
                  <small>{customer.phone}</small>
                </article>
                <article>
                  <span>Vérification identité</span>
                  <strong>{kycStatusNames[customer.kycStatus] || 'À vérifier'}</strong>
                  <small>Vérification KYC</small>
                </article>
              </div>
              <div className="customer-feature-grid">
                <article className="customer-feature-card">
                  <span>WALLET HD</span>
                  <h3>Portefeuille custodial</h3>
                  <p>
                    Les adresses seront attribuées après configuration du signataire HD isolé et
                    validation du contrôle d’identité.
                  </p>
                  <Link to="/portefeuille">Voir l’état du wallet →</Link>
                  <b className="feature-lock">EN PRÉPARATION</b>
                </article>
                <article className="customer-feature-card">
                  <span>OPÉRATIONS</span>
                  <h3>Dépôts et retraits</h3>
                  <p>
                    Les mouvements réels sont verrouillés tant que les contrôles de conformité et la
                    chaîne de signature ne sont pas prêts.
                  </p>
                  <Link to="/verification">Consulter la vérification →</Link>
                  <b className="feature-lock">INACTIFS</b>
                </article>
                <article className="customer-feature-card">
                  <span>RENDEMENT</span>
                  <h3>Produits de staking</h3>
                  <p>
                    Aucun rendement n’est affiché sans protocole, durée, risques et conditions
                    validés.
                  </p>
                  <Link to="/staking">Voir le statut →</Link>
                  <b className="feature-lock">INACTIF</b>
                </article>
              </div>
              <section className="customer-order-history">
                <div className="customer-order-history-heading">
                  <div>
                    <span className="eyebrow plain">ACTIVITÉ</span>
                    <h2>Mes achats et ventes</h2>
                  </div>
                  <Link to="/acheter">Nouvelle opération ↗</Link>
                </div>
                {orders.length ? (
                  <div className="customer-orders-table">
                    {orders.map((order) => (
                      <Link
                        className="customer-order-row"
                        to={`/suivi?ref=${encodeURIComponent(order.ref)}`}
                        key={order.ref}
                      >
                        <span className={`order-mode-dot ${order.mode}`}>
                          {order.mode === 'buy' ? '↓' : '↑'}
                        </span>
                        <span className="customer-order-description">
                          <strong>
                            {order.mode === 'buy' ? 'Achat' : 'Vente'} {order.asset}
                          </strong>
                          <small>
                            {order.ref} · {new Date(order.createdAt).toLocaleDateString('fr-FR')}
                          </small>
                        </span>
                        <strong className="customer-order-amount">{money(order.amountXaf)}</strong>
                        <span className={`customer-order-status order-${order.status}`}>
                          {statusNames[order.status] || order.status}
                        </span>
                        <span className="customer-order-arrow">↗</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="customer-empty-orders">
                    Aucune opération enregistrée sur ton compte pour le moment.
                  </p>
                )}
                {orderHistoryError && <Notice>{orderHistoryError}</Notice>}
                {orders.length > 0 && (
                  <div className="customer-history-pagination">
                    <span>
                      {orders.length} sur {orderPagination.total} opérations
                    </span>
                    {orderPagination.page < orderPagination.pages && (
                      <button
                        className="button button-outline compact"
                        onClick={loadMoreOrders}
                        disabled={orderHistoryLoading}
                      >
                        {orderHistoryLoading ? 'Chargement…' : 'Charger les opérations précédentes'}
                      </button>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          {path === '/portefeuille' && (
            <>
              <section className="customer-module-card">
                <div className="module-lock-icon">◈</div>
                <span className="eyebrow plain">CONSERVATION SÉCURISÉE</span>
                <h2>Votre portefeuille, conservé par DAE.</h2>
                <p>
                  DAE conserve les actifs et attribuera à votre compte des adresses générées depuis
                  sa clé maîtresse HD, séparément pour chaque réseau pris en charge. Cette clé
                  restera dans un signataire isolé, jamais sur le site ni dans la base de données.
                  La génération des adresses est en préparation et elles resteront masquées jusqu’à
                  la mise en service et la validation du signataire.
                </p>
                <div className="module-state">
                  <i /> {features?.custody?.wallets?.status || 'Vérification du signataire'}
                </div>
              </section>
              <section className="customer-wallet-list customer-ledger-balances" aria-label="Soldes du compte">
                <div className="customer-wallet-list-heading">
                  <div>
                    <span className="eyebrow plain">COMPTABILITÉ DU COMPTE</span>
                    <h2>Soldes internes</h2>
                  </div>
                  <span>Ledger DAE · lecture seule</span>
                </div>
                {balancesError ? (
                  <p className="customer-empty-wallets">Impossible de charger les soldes internes.</p>
                ) : balancesLoading ? (
                  <p className="customer-empty-wallets">Chargement des soldes…</p>
                ) : balances.length ? (
                  <>
                    <div className="customer-ledger-balance-heading" aria-hidden="true">
                      <span>Actif · réseau</span>
                      <span>Disponible</span>
                      <span>Réservé</span>
                      <span>Staké</span>
                    </div>
                    {balances.map((balance) => (
                      <article
                        className="customer-ledger-balance-row"
                        key={`${balance.asset}:${balance.network}`}
                      >
                        <strong>
                          {balance.asset}
                          <small>{balance.network}</small>
                        </strong>
                        <span>
                          <small>Disponible</small>
                          {formatDecimalString(balance.available)}
                        </span>
                        <span>
                          <small>Réservé</small>
                          {formatDecimalString(balance.reserved)}
                        </span>
                        <span>
                          <small>Staké</small>
                          {formatDecimalString(balance.staked)}
                        </span>
                      </article>
                    ))}
                  </>
                ) : (
                  <p className="customer-empty-wallets">
                    Aucune écriture de solde dans le ledger pour ce compte. Les soldes on-chain
                    apparaîtront après l’intégration de la garde et des indexeurs.
                  </p>
                )}
                <p className="customer-ledger-disclaimer">
                  Les mouvements de fonds restent désactivés. Ces montants proviennent uniquement
                  du ledger interne et ne constituent pas une preuve de fonds on-chain.
                </p>
              </section>
              <section className="customer-wallet-list" aria-label="Réseaux du portefeuille">
                <div className="customer-wallet-list-heading">
                  <div>
                  <span className="eyebrow plain">RÉSEAU DE GARDE</span>
                  <h2>USDT · BNB Smart Chain</h2>
                  </div>
                  <span>Solde · —</span>
                </div>
                {wallets.filter((wallet) => wallet.network === 'BEP20').map((wallet) => (
                  <article className="customer-wallet-row" key={wallet.network}>
                    <span className="wallet-chain-mark">
                      {wallet.chain.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{wallet.chain.toUpperCase()}</strong>
                      <small>{wallet.network}</small>
                    </div>
                    {wallet.address ? (
                      <span className="wallet-address-value" title={wallet.address}>{wallet.address}</span>
                    ) : (
                      <span className="wallet-pending">{wallet.status === 'suspended' ? 'Portefeuille suspendu' : 'Adresse en préparation'}</span>
                    )}
                    <strong>—</strong>
                  </article>
                ))}
                {!wallets.length && (
                  <p className="customer-empty-wallets">Aucun réseau configuré pour ce compte.</p>
                )}
              </section>
            </>
          )}
          {path === '/depot' && (
            <>
            <section className="customer-module-card">
              <div className="module-lock-icon">↓</div>
              <span className="eyebrow plain">DÉPÔT · BNB SMART CHAIN</span>
              <h2>Déposer Binance-Peg BSC-USD (BEP20)</h2>
              {features?.custody?.deposits?.enabled && wallets.find((wallet) => wallet.network === 'BEP20')?.address ? (
                <>
                  <p>Cette adresse accepte uniquement le contrat Binance-Peg BSC-USD sur BNB Smart Chain. Vérifiez le réseau avant chaque envoi.</p>
                  <div className="bsc-deposit-address">
                    <code>{wallets.find((wallet) => wallet.network === 'BEP20').address}</code>
                    <button className="button button-outline compact" onClick={() => navigator.clipboard?.writeText(wallets.find((wallet) => wallet.network === 'BEP20').address)}>Copier</button>
                  </div>
                  <div className="module-state"><i /> Indexeur BSC connecté · 15 confirmations</div>
                </>
              ) : (
                <>
                  <p>L’adresse s’affichera après validation KYC, configuration du xpub public et connexion continue de l’indexeur BSC.</p>
                  <div className="module-state"><i /> {features?.custody?.deposits?.status || 'Indexeur BSC hors ligne'}</div>
                </>
              )}
            </section>
            <CustomerFundingHistory type="deposit" />
            </>
          )}
          {path === '/retrait' && (
            <>
            <section className="customer-module-card">
              <div className="module-lock-icon">↑</div>
              <span className="eyebrow plain">RETRAIT · BNB SMART CHAIN</span>
              <h2>Retirer Binance-Peg BSC-USD (BEP20)</h2>
              <p>
                Les retraits sont envoyés automatiquement depuis le portefeuille mère si le solde,
                le compte vérifié, le KYC et le signataire local DAE sont disponibles. Les frais de
                gaz BNB sont gérés par le portefeuille de frais DAE.
              </p>
              {features?.custody?.withdrawals?.enabled ? (
                <form className="bsc-withdrawal-form" onSubmit={submitBscWithdrawal}>
                  <label>Montant · USDT BEP20<input required inputMode="decimal" value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} placeholder="0.00" /></label>
                  <label>Adresse BSC de destination<input required value={withdrawalDestination} onChange={(event) => setWithdrawalDestination(event.target.value)} placeholder="0x…" autoComplete="off" /></label>
                  <button className="button button-primary" disabled={withdrawalBusy}>{withdrawalBusy ? 'Envoi…' : 'Retirer'}</button>
                </form>
              ) : (
                <div className="module-state"><i /> {features?.custody?.withdrawals?.status || 'Retraits non activés'}</div>
              )}
              {withdrawalMessage && <p role="status">{withdrawalMessage}</p>}
              {withdrawalError && <Notice>{withdrawalError}</Notice>}
            </section>
            <CustomerFundingHistory key={withdrawalRefresh} type="withdrawal" />
            </>
          )}
          {path === '/staking' && (
            <>
            <section className="customer-module-card">
              <div className="module-lock-icon">◇</div>
              <span className="eyebrow plain">STAKING</span>
              <h2>Aucun produit de staking n’est ouvert.</h2>
              <p>
                Les offres de rendement ne seront publiées qu’après validation du protocole, des
                actifs, des périodes de blocage, des frais, des récompenses et des risques.
              </p>
              <div className="module-state">
                <i /> Produit non configuré
              </div>
            </section>
            <CustomerFundingHistory type="staking" />
            </>
          )}
          {path === '/verification' && (
            <section className="customer-module-card">
              <div className="module-lock-icon">✓</div>
              <span className="eyebrow plain">CONNAISSANCE CLIENT</span>
              <h2>
                Vérification d’identité : {kycStatusNames[customer.kycStatus] || 'À vérifier'}.
              </h2>
              <p>
                {customer.kycStatus === 'approved'
                  ? 'Votre identité a été validée. La disponibilité des opérations reste soumise aux contrôles et aux services DAE.'
                  : customer.kycStatus === 'pending'
                    ? 'Votre dossier est indiqué en cours de vérification. Les dépôts, retraits et autres mouvements restent désactivés.'
                    : customer.kycStatus === 'rejected'
                      ? 'Une action est nécessaire pour votre vérification. Contactez l’assistance DAE pour connaître la suite à donner.'
                      : 'La vérification est effectuée manuellement par DAE. Contactez l’assistance pour confirmer la réception de votre dossier.'}
              </p>
              <div className="module-state">
                <i />
                {customer.kycStatus === 'approved'
                  ? 'Identité validée'
                  : customer.kycStatus === 'pending'
                    ? 'Dossier en cours de vérification'
                    : customer.kycStatus === 'rejected'
                      ? 'Assistance requise'
                      : 'Revue manuelle par DAE'}
              </div>
            </section>
          )}
          {path === '/securite' && (
            <>
              <section className="customer-module-card">
                <div className="module-lock-icon">⌑</div>
                <span className="eyebrow plain">ACCÈS AU COMPTE</span>
                <h2>Sessions ouvertes</h2>
                <p>
                  La connexion DAE demande une confirmation par e-mail et SMS. Consultez les
                  sessions actives ci-dessous et déconnectez les autres appareils si nécessaire.
                </p>
                <div className="module-state">
                  <i /> Sessions révocables à distance
                </div>
              </section>
              <section
                className="customer-wallet-list customer-session-list"
                aria-label="Sessions actives"
              >
                <div className="customer-wallet-list-heading">
                  <div>
                    <span className="eyebrow plain">APPAREILS CONNECTÉS</span>
                    <h2>
                      {activeSessionCount} session{activeSessionCount === 1 ? '' : 's'} active
                      {activeSessionCount === 1 ? '' : 's'}
                    </h2>
                  </div>
                  <button
                    className="button button-outline compact"
                    onClick={revokeOtherSessions}
                    disabled={sessionsBusy || sessionsLoading || activeSessionCount <= 1}
                  >
                    {sessionsBusy ? 'Déconnexion…' : 'Déconnecter les autres'}
                  </button>
                </div>
                {sessionsError && <Notice>{sessionsError}</Notice>}
                {sessionsMessage && <Notice type="success">{sessionsMessage}</Notice>}
                {sessionsLoading ? (
                  <p className="customer-empty-wallets">Chargement des sessions…</p>
                ) : sessions.length ? (
                  sessions.map((session) => (
                    <article className="customer-wallet-row" key={session.id}>
                      <span className="wallet-chain-mark">{session.current ? '✓' : '•'}</span>
                      <div>
                        <strong>{session.current ? 'Cet appareil' : 'Autre appareil'}</strong>
                        <small>
                          Connexion le {new Date(session.createdAt).toLocaleString('fr-FR')} · expire
                          le{' '}
                          {new Date(session.expiresAt).toLocaleString('fr-FR')}
                        </small>
                      </div>
                      <span className={session.current ? 'customer-verified' : 'wallet-pending'}>
                        {session.current ? 'Session actuelle' : 'Active'}
                      </span>
                    </article>
                  ))
                ) : (
                  <p className="customer-empty-wallets">Aucune session active trouvée.</p>
                )}
                {activeSessionCount > sessions.length && (
                  <p className="customer-empty-wallets">
                    Les {sessions.length} sessions les plus récentes sont affichées. La révocation
                    concerne aussi les sessions plus anciennes.
                  </p>
                )}
              </section>
            </>
          )}
          <footer className="customer-content-footer">
            DAE Crypto · République du Congo <Link to="/contact">Besoin d’aide ?</Link>
          </footer>
        </div>
      </main>
    </div>
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
  const [ordersPagination, setOrdersPagination] = useState({
    page: 1,
    pageSize: 50,
    total: 0,
    pages: 1,
  });
  const [orderPage, setOrderPage] = useState(1);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customerSummary, setCustomerSummary] = useState(null);
  const [customerPagination, setCustomerPagination] = useState({
    page: 1,
    pageSize: 50,
    total: 0,
    pages: 1,
  });
  const [customerPage, setCustomerPage] = useState(1);
  const [customerStatusFilter, setCustomerStatusFilter] = useState('');
  const [customerKycFilter, setCustomerKycFilter] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerActionId, setCustomerActionId] = useState('');
  const [customerAuditId, setCustomerAuditId] = useState('');
  const [customerAuditEvents, setCustomerAuditEvents] = useState([]);
  const [customerAuditLoading, setCustomerAuditLoading] = useState(false);
  const customerAuditRequestId = useRef(0);
  const customersRequestId = useRef(0);
  const ordersRequestId = useRef(0);
  const [rates, setRates] = useState([]);
  const [settings, setSettings] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [bscCustodyBalances, setBscCustodyBalances] = useState(null);
  const [bscSweepBusy, setBscSweepBusy] = useState(false);
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
  const collectBscFunds = async () => {
    const reason = window.prompt('Motif de la collecte vers le portefeuille mère (minimum 8 caractères) :');
    if (!reason || reason.trim().length < 8) return;
    if (!window.confirm('Créer une collecte BSC de tous les portefeuilles clients approuvés ? Les soldes des comptes resteront inchangés.')) return;
    setBscSweepBusy(true);
    try {
      const result = await api('/api/admin/custody/bsc/collect', {
        method: 'POST', admin: true,
        headers: { 'Idempotency-Key': createClientId() },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      notify(`Collecte ${result.runId} créée pour ${result.walletCount} portefeuille(s).`);
      load();
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBscSweepBusy(false);
    }
  };
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [d, r, s, readinessState, custodyBalances] = await Promise.all([
        api('/api/admin/dashboard', { admin: true }),
        api('/api/admin/rates', { admin: true }),
        api('/api/admin/settings', { admin: true }),
        api('/api/admin/readiness', { admin: true }),
        api('/api/admin/custody/bsc/balances', { admin: true }).catch(() => null),
      ]);
      setDashboard(d);
      setRates(r);
      setSettings(s);
      setReadiness(readinessState);
      setBscCustodyBalances(custodyBalances);
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
  }, [token]);
  useEffect(() => {
    if (token) load();
  }, [token, load]);
  const loadOrders = useCallback(async () => {
    if (!token) return;
    const requestId = ++ordersRequestId.current;
    setOrdersLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (query.trim()) params.set('q', query.trim());
    params.set('page', String(orderPage));
    try {
      const result = await api(`/api/admin/orders?${params.toString()}`, { admin: true });
      if (requestId === ordersRequestId.current) {
        setOrders(result.orders || []);
        setOrdersPagination(result.pagination || { page: 1, pageSize: 50, total: 0, pages: 1 });
        if (result.pagination?.page && result.pagination.page !== orderPage) {
          setOrderPage(result.pagination.page);
        }
      }
    } catch (requestError) {
      if (requestError.message.toLowerCase().includes('session')) logout();
      notify(requestError.message, true);
    } finally {
      if (requestId === ordersRequestId.current) setOrdersLoading(false);
    }
  }, [token, statusFilter, query, orderPage]);
  useEffect(() => {
    if (!token) return undefined;
    const timeout = setTimeout(loadOrders, 250);
    return () => clearTimeout(timeout);
  }, [token, loadOrders]);
  const loadCustomers = useCallback(async () => {
    if (!token) return;
    const requestId = ++customersRequestId.current;
    setCustomersLoading(true);
    const params = new URLSearchParams();
    if (customerSearch.trim()) params.set('q', customerSearch.trim());
    if (customerStatusFilter) params.set('status', customerStatusFilter);
    if (customerKycFilter) params.set('kycStatus', customerKycFilter);
    params.set('page', String(customerPage));
    try {
      const result = await api(`/api/admin/customers?${params.toString()}`, { admin: true });
      if (requestId === customersRequestId.current) {
        setCustomers(result.customers || []);
        setCustomerSummary(result.summary || null);
        setCustomerPagination(result.pagination || { page: 1, pageSize: 50, total: 0, pages: 1 });
        if (result.pagination?.page && result.pagination.page !== customerPage) {
          setCustomerPage(result.pagination.page);
        }
      }
    } catch (requestError) {
      if (requestError.message.toLowerCase().includes('session')) logout();
      notify(requestError.message, true);
    } finally {
      if (requestId === customersRequestId.current) setCustomersLoading(false);
    }
  }, [token, customerSearch, customerStatusFilter, customerKycFilter, customerPage]);
  async function updateCustomerAccess(customer) {
    const status = customer.status === 'active' ? 'locked' : customer.status === 'locked' ? 'active' : '';
    if (!status || customerActionId) return;
    const verb = status === 'locked' ? 'suspendre' : 'réactiver';
    const reason = window.prompt(`Motif requis pour ${verb} le compte de ${customer.firstName} ${customer.lastName} :`);
    if (reason === null) return;
    if (reason.trim().length < 8) {
      notify('Le motif doit contenir au moins 8 caractères.', true);
      return;
    }
    setCustomerActionId(String(customer._id));
    try {
      await api(`/api/admin/customers/${encodeURIComponent(customer._id)}/status`, {
        method: 'PATCH',
        admin: true,
        body: JSON.stringify({ status, reason: reason.trim() }),
      });
      await loadCustomers();
      notify(status === 'locked'
        ? 'Compte suspendu et sessions révoquées. Action inscrite au journal.'
        : 'Compte réactivé. Action inscrite au journal.');
    } catch (requestError) {
      notify(requestError.message, true);
    } finally {
      setCustomerActionId('');
    }
  }
  async function updateCustomerKyc(customer, status) {
    if (customerActionId) return;
    const verb = status === 'approved' ? 'approuver' : status === 'rejected' ? 'refuser ou révoquer' : 'démarrer la revue';
    let evidenceReference = '';
    if (status === 'approved') {
      evidenceReference = window.prompt('Référence interne du dossier d’identité déjà vérifié (ne saisissez pas de numéro de pièce ici) :') || '';
      if (evidenceReference.trim().length < 3) return notify('La référence interne du dossier est requise pour approuver.', true);
    }
    const reason = window.prompt(`Motif de décision pour ${verb} le KYC de ${customer.firstName} ${customer.lastName} :`);
    if (reason === null) return;
    if (reason.trim().length < 8) return notify('Le motif doit contenir au moins 8 caractères.', true);
    setCustomerActionId(String(customer._id));
    try {
      await api(`/api/admin/customers/${encodeURIComponent(customer._id)}/kyc`, {
        method: 'PATCH', admin: true,
        body: JSON.stringify({ status, reason: reason.trim(), evidenceReference: evidenceReference.trim() || undefined }),
      });
      await loadCustomers();
      notify('Décision KYC enregistrée dans le journal.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setCustomerActionId('');
    }
  }
  async function toggleCustomerAudit(customer) {
    const customerId = String(customer._id);
    if (customerAuditId === customerId) {
      customerAuditRequestId.current += 1;
      setCustomerAuditId('');
      return;
    }
    const requestId = ++customerAuditRequestId.current;
    setCustomerAuditId(customerId);
    setCustomerAuditEvents([]);
    setCustomerAuditLoading(true);
    try {
      const [accessAudit, kycAudit] = await Promise.all([
        api(`/api/admin/customers/${encodeURIComponent(customerId)}/audit`, { admin: true }),
        api(`/api/admin/customers/${encodeURIComponent(customerId)}/kyc-audit`, { admin: true }),
      ]);
      if (requestId === customerAuditRequestId.current) {
        setCustomerAuditEvents([
          ...(accessAudit.events || []).map((event) => ({ ...event, eventType: 'access' })),
          ...(kycAudit.events || []).map((event) => ({ ...event, eventType: 'kyc' })),
        ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)));
      }
    } catch (requestError) {
      if (requestId === customerAuditRequestId.current) notify(requestError.message, true);
    } finally {
      if (requestId === customerAuditRequestId.current) setCustomerAuditLoading(false);
    }
  }
  useEffect(() => {
    if (!token) return undefined;
    const timeout = setTimeout(loadCustomers, 250);
    return () => clearTimeout(timeout);
  }, [token, loadCustomers]);
  function logout() {
    customersRequestId.current += 1;
    ordersRequestId.current += 1;
    sessionStorage.removeItem('dae-admin-session');
    setToken('');
    setDashboard(null);
    setCustomers([]);
    setOrders([]);
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
      await Promise.all([load(), loadOrders()]);
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
  const filtered = orders;
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
          ['customers', '♙', 'Comptes clients'],
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
            {id === 'customers' && customerSummary?.kycPending > 0 && (
              <i>{customerSummary.kycPending}</i>
            )}
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
                customers: 'Comptes clients',
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
                    customers: 'Comptes clients',
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
                  <section className="admin-card readiness-card">
                    <div className="card-heading">
                      <div>
                        <h2>Disponibilité des services</h2>
                        <p>
                          État de configuration · les services custodials ne peuvent pas être
                          activés depuis cette page.
                        </p>
                      </div>
                      <span className="readiness-lock">
                        MOUVEMENTS DE FONDS ·{' '}
                        {readiness?.assetMovementsEnabled ? 'ACTIFS' : 'INACTIFS'}
                      </span>
                    </div>
                    {readiness.bsc?.sweepsEnabled && (
                      <div className="bsc-collection-action">
                        <p>
                          Binance-Peg BSC-USD · collectez les USDT BEP20 vers l’adresse mère. Le ledger client reste intact.
                          {readiness.bsc.signerOnline ? ' Signataire DAE connecté.' : ' Signataire local DAE hors ligne.'}
                        </p>
                        <button
                          className="button button-primary"
                          disabled={bscSweepBusy || !readiness.bsc.signerOnline}
                          onClick={collectBscFunds}
                        >
                          {bscSweepBusy ? 'Création de la collecte…' : 'Récolter les fonds vers le portefeuille mère'}
                        </button>
                      </div>
                    )}
                    {bscCustodyBalances?.available && (
                      <div className="bsc-custody-balances">
                        <span><small>Portefeuille mère</small><strong>{formatDecimalString(bscCustodyBalances.masterBscUsd)} BSC-USD</strong><small>{formatDecimalString(bscCustodyBalances.masterBnb)} BNB de gaz</small></span>
                        <span><small>Portefeuille frais de gaz</small><strong>{formatDecimalString(bscCustodyBalances.gasBnb)} BNB</strong><small>{bscCustodyBalances.queuedSweeps} collecte(s) en attente</small></span>
                        {bscCustodyBalances.lastCollection && <span><small>Dernière collecte</small><strong>{bscCustodyBalances.lastCollection.status}</strong><small>{bscCustodyBalances.lastCollection.walletCount} portefeuille(s) · {new Date(bscCustodyBalances.lastCollection.createdAt).toLocaleString('fr-FR')}</small></span>}
                      </div>
                    )}
                    {readiness ? (
                      <div className="readiness-list">
                        {[
                          {
                            label: 'Commandes de change manuelles',
                            enabled: readiness.manualExchange.enabled,
                            detail: readiness.manualExchange.enabled
                              ? 'Le traitement et le versement restent manuels via l’équipe.'
                              : 'MongoDB en replica set ou cluster compatible est requis pour journaliser chaque transition.',
                          },
                          {
                            label: 'Réception MTN Mobile Money',
                            enabled: readiness.paymentRails?.mtn,
                            detail: readiness.paymentRails?.mtn
                              ? 'Numéro de paiement configuré.'
                              : 'Ajoutez le numéro MTN dans Administration → Configuration.',
                          },
                          {
                            label: 'Réception Airtel Money',
                            enabled: readiness.paymentRails?.airtel,
                            detail: readiness.paymentRails?.airtel
                              ? 'Numéro de paiement configuré.'
                              : 'Ajoutez le numéro Airtel dans Administration → Configuration.',
                          },
                          {
                            label: 'UID Binance Pay DAE',
                            enabled: readiness.paymentRails?.binancePay,
                            detail: readiness.paymentRails?.binancePay
                              ? 'UID de réception configuré pour les ventes Binance Pay.'
                              : 'Ajoutez l’UID numérique DAE dans Administration → Configuration.',
                          },
                          {
                            label: 'Inscription des clients',
                            enabled: readiness.accounts.registration,
                            detail: readiness.accounts.registration
                              ? 'Canaux de vérification et documents publiés configurés.'
                              : 'E-mail/SMS, secret, origine HTTPS canonique et documents juridiques requis.',
                          },
                          {
                            label: 'Récupération sécurisée',
                            enabled: readiness.accounts.recovery,
                            detail: readiness.accounts.recovery
                              ? 'Codes e-mail/SMS et révocation atomique des sessions disponibles.'
                              : 'Canaux e-mail/SMS, origine HTTPS canonique et transactions MongoDB requis.',
                          },
                          {
                            label: 'Transactions MongoDB',
                            enabled: readiness.database?.transactions,
                            detail: readiness.database?.transactions
                              ? 'Replica set ou cluster shardé détecté.'
                              : 'Replica set requis pour les suspensions auditées et la récupération sécurisée.',
                          },
                          {
                            label: 'Vérification d’identité (KYC)',
                            enabled: readiness.identity.enabled,
                            detail: 'Revue manuelle des dossiers par un administrateur DAE, avec journalisation de la décision.',
                          },
                          {
                            label: 'Portefeuilles HD',
                            enabled: readiness.custody.wallets.enabled,
                            detail: readiness.custody.wallets.enabled
                              ? 'Adresse BSC dérivée par compte depuis le xpub public.'
                              : 'Configurez le xpub public BSC ; aucune phrase secrète ne doit être placée sur le serveur web.',
                          },
                          {
                            label: 'Dépôts BSC · Binance-Peg BSC-USD',
                            enabled: readiness.custody.deposits.enabled,
                            detail: readiness.custody.deposits.enabled
                              ? 'Indexeur BSC configuré ; le processus worker doit rester surveillé.'
                              : 'Indexeur et démarrage de l’indexation non activés.',
                          },
                          {
                            label: 'Retraits BSC automatisés',
                            enabled: readiness.custody.withdrawals.enabled,
                            detail: readiness.custody.withdrawals.enabled
                              ? 'Le signataire local DAE est connecté ; les retraits restent réservés aux comptes vérifiés et approuvés.'
                              : 'Activez la variable BSC_WITHDRAWALS_ENABLED et gardez le signataire local connecté ; MongoDB doit accepter les transactions.',
                          },
                          {
                            label: 'Staking',
                            enabled: readiness.custody.staking.enabled,
                            detail: 'Aucun produit ou protocole approuvé.',
                          },
                          {
                            label: 'Revue réglementaire déclarée',
                            enabled: false,
                            declaration: true,
                            declared: readiness.regulatoryReview,
                            detail:
                              'Attestation opérateur uniquement; aucune autorisation n’est vérifiée par l’application.',
                          },
                        ].map((item) => (
                          <article className="readiness-row" key={item.label}>
                            <span
                              className={
                                item.declaration
                                  ? 'readiness-indicator declared'
                                  : item.enabled
                                    ? 'readiness-indicator ready'
                                    : 'readiness-indicator'
                              }
                            />
                            <div>
                              <strong>{item.label}</strong>
                              <small>{item.detail}</small>
                            </div>
                            <span
                              className={
                                item.declaration
                                  ? 'readiness-state declared'
                                  : item.enabled
                                    ? 'readiness-state ready'
                                    : 'readiness-state'
                              }
                            >
                              {item.declaration
                                ? item.declared
                                  ? 'Déclarée · non vérifiée'
                                  : 'Non déclarée'
                                : item.enabled
                                  ? 'Configuré'
                                  : 'Inactif'}
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="loading">Chargement de l’état des services…</div>
                    )}
                  </section>
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
                  <p>
                    {ordersPagination.total} commande{ordersPagination.total === 1 ? '' : 's'}
                    {ordersLoading ? ' · actualisation…' : ''}
                  </p>
                </div>
              </div>
              <div className="filters">
                <input
                  aria-label="Rechercher"
                  placeholder="Référence, e-mail, téléphone…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOrderPage(1);
                  }}
                />
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setOrderPage(1);
                  }}
                >
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
                          {formatDecimalString(String(o.amountCrypto ?? o.amountUsdt ?? ''))} {o.asset}
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
                    {ordersLoading
                      ? 'Chargement des commandes…'
                      : 'Aucune commande ne correspond à cette recherche.'}
                  </div>
                )}
              </div>
              <div className="customer-pagination">
                <span>
                  {ordersPagination.total
                    ? `${(ordersPagination.page - 1) * ordersPagination.pageSize + 1}–${Math.min(ordersPagination.page * ordersPagination.pageSize, ordersPagination.total)} sur ${ordersPagination.total} commandes`
                    : 'Aucune commande'}
                </span>
                <div>
                  <button
                    className="button button-outline compact"
                    onClick={() => setOrderPage((page) => Math.max(1, page - 1))}
                    disabled={ordersLoading || ordersPagination.page <= 1}
                  >
                    Précédent
                  </button>
                  <span>
                    Page {ordersPagination.page} / {ordersPagination.pages}
                  </span>
                  <button
                    className="button button-outline compact"
                    onClick={() =>
                      setOrderPage((page) => Math.min(ordersPagination.pages, page + 1))
                    }
                    disabled={ordersLoading || ordersPagination.page >= ordersPagination.pages}
                  >
                    Suivant
                  </button>
                </div>
              </div>
            </div>
          )}
          {tab === 'customers' && (
            <>
              <div className="stats-grid customer-admin-stats">
                {[
                  ['Comptes clients', customerSummary?.total ?? '—'],
                  ['Actifs', customerSummary?.active ?? '—'],
                  ['Coordonnées à vérifier', customerSummary?.pendingVerification ?? '—'],
                  ['KYC en revue', customerSummary?.kycPending ?? '—'],
                  ['KYC approuvés', customerSummary?.kycApproved ?? '—'],
                ].map(([label, value]) => (
                  <article className="stat-card" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>État du registre client</small>
                  </article>
                ))}
              </div>
              <div className="admin-card customer-admin-card">
                <div className="card-heading">
                  <div>
                    <h2>Supervision des comptes</h2>
                    <p>Décision manuelle sur les justificatifs reçus par DAE ; statut et motif sont journalisés.</p>
                  </div>
                  <button
                    className="button button-outline compact"
                    onClick={loadCustomers}
                    disabled={customersLoading}
                  >
                    {customersLoading ? 'Chargement…' : 'Actualiser'}
                  </button>
                </div>
                <div className="filters customer-admin-filters">
                  <input
                    aria-label="Rechercher un compte client"
                    placeholder="Nom, e-mail ou téléphone…"
                    value={customerSearch}
                    onChange={(event) => {
                      setCustomerSearch(event.target.value);
                      setCustomerPage(1);
                    }}
                  />
                  <select
                    value={customerStatusFilter}
                    onChange={(event) => {
                      setCustomerStatusFilter(event.target.value);
                      setCustomerPage(1);
                    }}
                  >
                    <option value="">Tous les comptes</option>
                    <option value="pending_verification">Coordonnées à vérifier</option>
                    <option value="active">Actifs</option>
                    <option value="locked">Verrouillés</option>
                    <option value="closed">Fermés</option>
                  </select>
                  <select
                    value={customerKycFilter}
                    onChange={(event) => {
                      setCustomerKycFilter(event.target.value);
                      setCustomerPage(1);
                    }}
                  >
                    <option value="">Tous les statuts KYC</option>
                    <option value="not_started">Non démarré</option>
                    <option value="pending">En revue</option>
                    <option value="approved">Approuvé</option>
                    <option value="rejected">Refusé</option>
                  </select>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Contact vérifié</th>
                        <th>Compte</th>
                        <th>KYC</th>
                        <th>Inscription</th>
                        <th>Dernière connexion</th>
                        <th>Accès</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((customer) => (
                        <tr key={customer._id}>
                          <td>
                            <strong>
                              {customer.firstName} {customer.lastName}
                            </strong>
                            <small>{customer.email}</small>
                          </td>
                          <td>
                            <span
                              className={
                                customer.emailVerifiedAt
                                  ? 'customer-verified'
                                  : 'customer-unverified'
                              }
                            >
                              E-mail {customer.emailVerifiedAt ? 'confirmé' : 'non confirmé'}
                            </span>
                            <small
                              className={
                                customer.phoneVerifiedAt
                                  ? 'customer-verified'
                                  : 'customer-unverified'
                              }
                            >
                              SMS {customer.phoneVerifiedAt ? 'confirmé' : 'non confirmé'} ·{' '}
                              {customer.phone}
                            </small>
                          </td>
                          <td>
                            <span className={`customer-admin-state state-${customer.status}`}>
                              {{
                                pending_verification: 'Coordonnées en attente',
                                active: 'Actif',
                                locked: 'Verrouillé',
                                closed: 'Fermé',
                              }[customer.status] || customer.status}
                            </span>
                          </td>
                          <td>
                            <span className={`customer-admin-state kyc-${customer.kycStatus}`}>
                              {{
                                not_started: 'Non démarré',
                                pending: 'En revue',
                                approved: 'Approuvé',
                                rejected: 'Refusé',
                              }[customer.kycStatus] || customer.kycStatus}
                            </span>
                            <div className="customer-kyc-actions">
                              {['not_started', 'rejected'].includes(customer.kycStatus) && (
                                <button className="button button-outline compact" disabled={customerActionId === String(customer._id)} onClick={() => updateCustomerKyc(customer, 'pending')}>Démarrer la revue</button>
                              )}
                              {customer.kycStatus === 'pending' && (
                                <>
                                  <button className="button button-outline compact" disabled={customerActionId === String(customer._id) || customer.status !== 'active' || !customer.emailVerifiedAt || !customer.phoneVerifiedAt} onClick={() => updateCustomerKyc(customer, 'approved')}>Approuver</button>
                                  <button className="button button-outline compact" disabled={customerActionId === String(customer._id)} onClick={() => updateCustomerKyc(customer, 'rejected')}>Refuser</button>
                                </>
                              )}
                              {customer.kycStatus === 'approved' && (
                                <button className="button button-outline compact" disabled={customerActionId === String(customer._id)} onClick={() => updateCustomerKyc(customer, 'rejected')}>Révoquer</button>
                              )}
                            </div>
                          </td>
                          <td>{new Date(customer.createdAt).toLocaleDateString('fr-FR')}</td>
                          <td>
                            {customer.lastLoginAt
                              ? new Date(customer.lastLoginAt).toLocaleString('fr-FR')
                              : 'Jamais'}
                          </td>
                          <td>
                            {['active', 'locked'].includes(customer.status) && (
                              <button
                                className="button button-outline compact"
                                disabled={customerActionId === String(customer._id)}
                                onClick={() => updateCustomerAccess(customer)}
                              >
                                {customerActionId === String(customer._id)
                                  ? 'Mise à jour…'
                                  : customer.status === 'active' ? 'Suspendre' : 'Réactiver'}
                              </button>
                            )}
                            <button
                              className="button button-outline compact"
                              onClick={() => toggleCustomerAudit(customer)}
                            >
                              {customerAuditId === String(customer._id) ? 'Fermer' : 'Journal'}
                            </button>
                            {customerAuditId === String(customer._id) && (
                              <div className="customer-audit-inline" aria-live="polite">
                                {customerAuditLoading ? 'Chargement du journal…' : customerAuditEvents.length ? customerAuditEvents.map((event) => (
                                  <article key={`${event.eventType}-${event.createdAt}`}>
                                    <strong>{event.eventType === 'kyc'
                                      ? `KYC : ${{ not_started: 'non démarré', pending: 'en revue', approved: 'approuvé', rejected: 'refusé' }[event.toStatus] || event.toStatus}`
                                      : event.action === 'account_locked' ? 'Compte suspendu' : 'Compte réactivé'}</strong>
                                    <small>{new Date(event.createdAt).toLocaleString('fr-FR')} · {event.actor}</small>
                                    {event.evidenceReference && <small>Référence dossier : {event.evidenceReference}</small>}
                                    <p>{event.reason}</p>
                                  </article>
                                )) : 'Aucune action enregistrée.'}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!customers.length && (
                    <div className="empty-state">
                      {customersLoading
                        ? 'Chargement des comptes…'
                        : 'Aucun compte ne correspond aux filtres.'}
                    </div>
                  )}
                </div>
                <div className="customer-pagination">
                  <span>
                    {customerPagination.total
                      ? `${(customerPagination.page - 1) * customerPagination.pageSize + 1}–${Math.min(customerPagination.page * customerPagination.pageSize, customerPagination.total)} sur ${customerPagination.total} comptes`
                      : 'Aucun compte'}
                  </span>
                  <div>
                    <button
                      className="button button-outline compact"
                      onClick={() => setCustomerPage((page) => Math.max(1, page - 1))}
                      disabled={customersLoading || customerPagination.page <= 1}
                    >
                      Précédent
                    </button>
                    <span>
                      Page {customerPagination.page} / {customerPagination.pages}
                    </span>
                    <button
                      className="button button-outline compact"
                      onClick={() =>
                        setCustomerPage((page) => Math.min(customerPagination.pages, page + 1))
                      }
                      disabled={customersLoading || customerPagination.page >= customerPagination.pages}
                    >
                      Suivant
                    </button>
                  </div>
                </div>
                <p className="customer-admin-footnote">
                  La confirmation e-mail/SMS ne vaut pas vérification d’identité.
                </p>
              </div>
            </>
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
                  {formatDecimalString(String(selected.amountCrypto ?? selected.amountUsdt ?? ''))} {selected.asset}
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
                  <small>
                    {new Date(event.createdAt).toLocaleString('fr-FR')}
                    {event.actorType ? ` · ${eventActorNames[event.actorType] || event.actorType}` : ''}
                  </small>
                  {event.note && <small>Note : {event.note}</small>}
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
  const route = useLocation();
  const path = route.pathname.replace(/\/$/, '') || '/';
  useEffect(() => {
    if (!route.hash) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(route.hash)?.scrollIntoView({ behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [route.hash, route.pathname]);
  if (path === '/admin') return <Admin />;
  if (path === '/inscription') return <AccountAccess initialMode="register" />;
  if (path === '/connexion') return <AccountAccess initialMode="login" />;
  if (path === '/mot-de-passe-oublie') return <PasswordRecovery />;
  if (
    ['/compte', '/portefeuille', '/depot', '/retrait', '/staking', '/verification', '/securite'].includes(path)
  )
    return <CustomerPortal />;
  if (path === '/acheter') return <Exchange key="buy" mode="buy" />;
  if (path === '/vendre') return <Exchange key="sell" mode="sell" />;
  if (path === '/suivi' || path === '/attente') return <Tracking key={path} />;
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
