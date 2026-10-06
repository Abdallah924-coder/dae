(function () {
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (options.admin) {
      const token = sessionStorage.getItem('dae-admin-session');
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetch(path, { ...options, headers });
    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
    return data;
  }

  function formatXaf(value) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value) + ' FCFA';
  }

  function formatCrypto(value, digits = 8) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(value);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function initMenus() {
    document.querySelectorAll('[data-menu-toggle]').forEach((button) => {
      const menu = document.getElementById(button.getAttribute('aria-controls'));
      if (!menu) return;
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        menu.classList.toggle('hidden', !open);
        button.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      });
      menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', 'Ouvrir le menu');
        menu.classList.add('hidden');
      }));
    });
  }

  window.Dae = { api, formatXaf, formatCrypto, escapeHTML };
  initMenus();
})();
