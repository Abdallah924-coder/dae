(function () {
  const loginPanel = document.getElementById('login-panel');
  const adminPanel = document.getElementById('admin-panel');
  const message = document.getElementById('admin-message');
  const statusLabels = {
    created: 'Créée', payment_declared: 'Paiement déclaré', processing: 'En traitement',
    completed: 'Terminée', cancelled: 'Refusée / annulée', expired: 'Expirée', failed: 'Échouée',
  };

  function notice(text, isError = false) {
    message.textContent = text;
    message.className = `mt-4 rounded-xl p-3 text-sm ${isError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`;
    message.classList.remove('hidden');
  }

  function showLogin(text = '') {
    loginPanel.classList.remove('hidden');
    adminPanel.classList.add('hidden');
    document.getElementById('logout-button').classList.add('hidden');
    if (text) {
      const error = document.getElementById('login-error');
      error.textContent = text;
      error.classList.remove('hidden');
    }
  }

  async function loadAdmin() {
    try {
      await loadOrders();
      loginPanel.classList.add('hidden');
      adminPanel.classList.remove('hidden');
      document.getElementById('logout-button').classList.remove('hidden');
    } catch (error) {
      sessionStorage.removeItem('dae-admin-session');
      showLogin(error.message);
    }
  }

  function setTab(tabName) {
    document.querySelectorAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === tabName;
      button.className = `rounded-t-xl px-4 py-3 text-sm font-bold ${active ? 'bg-white text-brand' : 'text-slate-500'}`;
    });
    document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== tabName));
  }

  async function loadOrders() {
    const filter = document.getElementById('status-filter').value;
    const result = await Dae.api(`/api/admin/orders${filter ? `?status=${encodeURIComponent(filter)}` : ''}`, { admin: true });
    const container = document.getElementById('orders-list');
    if (!result.length) {
      container.innerHTML = '<p class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">Aucune commande dans ce filtre.</p>';
      return;
    }
    container.innerHTML = result.map((order) => {
      const asset = order.asset || 'USDT';
      const payout = order.mode === 'buy'
        ? `<p class="mt-1"><strong>Mobile Money client :</strong> ${Dae.escapeHTML(order.operator)} · ${Dae.escapeHTML(order.phone)}</p><p class="mt-1 break-all"><strong>Portefeuille client :</strong> ${Dae.escapeHTML(order.wallet || '—')}</p>`
        : `<p class="mt-1"><strong>Mobile Money client :</strong> ${Dae.escapeHTML(order.operator)} · ${Dae.escapeHTML(order.phone)}</p>`;
      const acceptLabel = order.status === 'processing' ? 'Marquer terminée' : 'Valider / traiter';
      const acceptStatus = order.status === 'processing' ? 'completed' : 'processing';
      const canAccept = ['created', 'payment_declared', 'processing'].includes(order.status);
      const canReject = ['created', 'payment_declared', 'processing'].includes(order.status);
      return `<article class="rounded-2xl border border-slate-200 bg-white p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><p class="font-mono text-sm font-bold text-brand">${Dae.escapeHTML(order.ref)}</p><h3 class="mt-1 text-lg font-bold">${order.mode === 'buy' ? 'Achat' : 'Vente'} · ${Dae.escapeHTML(asset)} · ${Dae.escapeHTML(Dae.formatCrypto(order.amountCrypto ?? order.amountUsdt))} ${Dae.escapeHTML(asset)}</h3><p class="mt-1 text-sm text-slate-500">Valeur : ${Dae.escapeHTML(Dae.formatCrypto(order.amountUsdt, 4))} USDT · cours bloqué : ${Dae.escapeHTML(Dae.formatCrypto(order.unitPriceUsd, order.unitPriceUsd < 1 ? 6 : 2))} USD</p></div>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">${Dae.escapeHTML(statusLabels[order.status] || order.status)}</span>
        </div>
        <div class="mt-3 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
          <p><strong>Équivalent :</strong> ${Dae.escapeHTML(Dae.formatXaf(order.amountXaf))}</p>
          <p><strong>Conversion appliquée :</strong> ${Dae.escapeHTML(Dae.formatXaf(order.rateApplied))} / USDT</p>
          <p><strong>Réseau :</strong> ${Dae.escapeHTML(order.networkName || order.network)}</p>
          <p><strong>Opérateur :</strong> ${Dae.escapeHTML(order.operator)}</p>
          <p><strong>E-mail client :</strong> ${Dae.escapeHTML(order.email || '—')}</p>
          ${payout}
          <p class="mt-1"><strong>Créée :</strong> ${Dae.escapeHTML(new Date(order.createdAt).toLocaleString('fr-FR'))}</p>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button data-proof="${Dae.escapeHTML(order.ref)}" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">Voir la preuve</button>
          ${canAccept ? `<button data-status="${acceptStatus}" data-ref="${Dae.escapeHTML(order.ref)}" class="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">${acceptLabel}</button>` : ''}
          ${canReject ? `<button data-status="cancelled" data-ref="${Dae.escapeHTML(order.ref)}" class="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white">Refuser</button>` : ''}
        </div>
        <div id="proof-${Dae.escapeHTML(order.ref)}" class="mt-4 hidden rounded-xl bg-slate-50 p-4"></div>
      </article>`;
    }).join('');

    container.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        const nextStatus = button.dataset.status;
        if (nextStatus === 'cancelled' && !window.confirm('Refuser ou annuler cette commande ?')) return;
        button.disabled = true;
        try {
          const result = await Dae.api(`/api/admin/orders/${encodeURIComponent(button.dataset.ref)}`, {
            method: 'PATCH', admin: true, body: JSON.stringify({ status: nextStatus }),
          });
          const actionMessage = nextStatus === 'cancelled' ? 'Commande refusée.' : nextStatus === 'completed' ? 'Commande terminée.' : 'Commande validée et mise en traitement.';
          notice(result.notificationSent === false
            ? `${actionMessage} Attention : l’e-mail de mise à jour n’a pas pu être envoyé.`
            : `${actionMessage} Un e-mail de statut a été envoyé au client.`);
          await loadOrders();
        } catch (error) {
          notice(error.message, true);
          button.disabled = false;
        }
      });
    });
    container.querySelectorAll('[data-proof]').forEach((button) => {
      button.addEventListener('click', async () => {
        const proofBox = document.getElementById(`proof-${button.dataset.proof}`);
        if (!proofBox.classList.contains('hidden')) {
          proofBox.classList.add('hidden');
          return;
        }
        button.disabled = true;
        try {
          const proof = await Dae.api(`/api/admin/orders/${encodeURIComponent(button.dataset.proof)}/proof`, { admin: true });
          proofBox.innerHTML = `<p class="text-sm"><strong>Référence :</strong> ${Dae.escapeHTML(proof.proof || 'Non fournie')}</p>${proof.image ? `<img src="${proof.image}" alt="Capture de paiement de ${Dae.escapeHTML(button.dataset.proof)}" class="mt-3 max-h-96 rounded-xl border border-slate-200">` : '<p class="mt-2 text-sm text-slate-500">Aucune capture enregistrée.</p>'}`;
          proofBox.classList.remove('hidden');
        } catch (error) {
          notice(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  async function loadRates() {
    const rates = await Dae.api('/api/admin/rates', { admin: true });
    const latest = rates.find((rate) => !rate.asset || rate.asset === 'USDT');
    if (latest) {
      const form = document.getElementById('rate-form');
      form.elements.usdtXafRate.value = latest.buyRate;
      form.elements.buyMinXaf.value = latest.buyMinXaf ?? latest.minXaf;
      form.elements.buyMaxXaf.value = latest.buyMaxXaf ?? latest.maxXaf;
      form.elements.sellMinXaf.value = latest.sellMinXaf ?? latest.minXaf;
      form.elements.sellMaxXaf.value = latest.sellMaxXaf ?? latest.maxXaf;
    }
    const rows = rates.filter((rate) => !rate.asset || rate.asset === 'USDT').map((rate) => {
      const buyMin = rate.buyMinXaf ?? rate.minXaf;
      const buyMax = rate.buyMaxXaf ?? rate.maxXaf;
      const sellMin = rate.sellMinXaf ?? rate.minXaf;
      const sellMax = rate.sellMaxXaf ?? rate.maxXaf;
      return `<tr class="border-t border-slate-100"><td class="px-4 py-3 font-bold">1 USDT</td><td class="px-4 py-3">${Dae.escapeHTML(Dae.formatXaf(rate.buyRate))}</td><td class="px-4 py-3">${Dae.escapeHTML(Dae.formatXaf(buyMin))} – ${Dae.escapeHTML(Dae.formatXaf(buyMax))}</td><td class="px-4 py-3">${Dae.escapeHTML(Dae.formatXaf(sellMin))} – ${Dae.escapeHTML(Dae.formatXaf(sellMax))}</td><td class="px-4 py-3 text-slate-500">${Dae.escapeHTML(new Date(rate.createdAt).toLocaleString('fr-FR'))}</td></tr>`;
    }).join('');
    document.getElementById('rates-list').innerHTML = `<table class="min-w-full text-left text-sm"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-4 py-3">Base</th><th class="px-4 py-3">Taux</th><th class="px-4 py-3">Limites achat</th><th class="px-4 py-3">Limites vente</th><th class="px-4 py-3">Mis à jour</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="px-4 py-5 text-slate-500">Taux par défaut : 640 FCFA / USDT.</td></tr>'}</tbody></table>`;
  }

  function networkRow(assetId, network = {}) {
    const id = network.id || `network-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    return `<div data-network-row class="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_1.5fr_auto] md:items-end">
      <input type="hidden" data-network-id value="${Dae.escapeHTML(id)}">
      <label class="text-sm font-semibold">Nom / réseau<input data-network-name required maxlength="80" value="${Dae.escapeHTML(network.name || '')}" placeholder="Ex. Ethereum (ERC20)" class="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"></label>
      <label class="text-sm font-semibold">Adresse de réception<input data-network-address maxlength="2000" value="${Dae.escapeHTML(network.address || '')}" placeholder="Adresse sur ce réseau précis" class="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"></label>
      <button type="button" data-remove-network class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-rose-200 hover:text-rose-700">Supprimer</button>
    </div>`;
  }

  function appendNetwork(assetId, network) {
    const list = document.querySelector(`[data-network-list="${assetId}"]`);
    if (!list || list.children.length >= 12) {
      notice('Chaque crypto peut avoir au maximum 12 réseaux.', true);
      return;
    }
    list.insertAdjacentHTML('beforeend', networkRow(assetId, network));
  }

  async function loadSettings() {
    const config = await Dae.api('/api/admin/settings', { admin: true });
    const form = document.getElementById('settings-form');
    form.elements.paymentMtn.value = config.paymentNumbers.mtn || '';
    form.elements.paymentAirtel.value = config.paymentNumbers.airtel || '';
    form.elements.paymentInstructions.value = config.paymentInstructions || '';
    form.elements.contactWhatsApp.value = config.contactWhatsApp || '';
    form.elements.contactEmail.value = config.contactEmail || '';
    const addresses = document.getElementById('network-addresses');
    addresses.innerHTML = config.assets.map((asset) => `<fieldset class="rounded-2xl border border-slate-200 bg-white p-5 md:p-6"><legend class="px-2 text-lg font-bold">${Dae.escapeHTML(asset.id)} · ${Dae.escapeHTML(asset.name)}</legend><p class="mb-4 text-sm text-slate-500">Configurez au moins 3 réseaux. Les réseaux peuvent être natifs ou enveloppés ; indiquez-le précisément dans leur nom.</p><div data-network-list="${Dae.escapeHTML(asset.id)}" class="space-y-3">${asset.networks.map((network) => networkRow(asset.id, network)).join('')}</div><button type="button" data-add-network="${Dae.escapeHTML(asset.id)}" class="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-brand hover:bg-emerald-50">Ajouter un réseau</button></fieldset>`).join('');
  }

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = document.getElementById('login-error');
    error.classList.add('hidden');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const session = await Dae.api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value }),
      });
      sessionStorage.setItem('dae-admin-session', session.token);
      form.elements.password.value = '';
      await loadAdmin();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('logout-button').addEventListener('click', () => {
    sessionStorage.removeItem('dae-admin-session');
    showLogin();
  });
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', async () => {
    setTab(button.dataset.tab);
    try {
      if (button.dataset.tab === 'rates') await loadRates();
      if (button.dataset.tab === 'settings') await loadSettings();
    } catch (error) {
      notice(error.message, true);
    }
  }));
  document.getElementById('refresh-orders').addEventListener('click', () => loadOrders().catch((error) => notice(error.message, true)));
  document.getElementById('status-filter').addEventListener('change', () => loadOrders().catch((error) => notice(error.message, true)));
  document.getElementById('rate-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await Dae.api('/api/admin/rates', {
        method: 'POST', admin: true,
        body: JSON.stringify({
          buyRate: form.elements.usdtXafRate.value,
          sellRate: form.elements.usdtXafRate.value,
          buyMinXaf: form.elements.buyMinXaf.value,
          buyMaxXaf: form.elements.buyMaxXaf.value,
          sellMinXaf: form.elements.sellMinXaf.value,
          sellMaxXaf: form.elements.sellMaxXaf.value,
        }),
      });
      notice('Nouveau taux enregistré.');
      form.reset();
      await loadRates();
    } catch (error) {
      notice(error.message, true);
    }
  });
  document.getElementById('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const networks = {};
    form.querySelectorAll('[data-network-list]').forEach((list) => {
      const assetId = list.dataset.networkList;
      networks[assetId] = [...list.querySelectorAll('[data-network-row]')].map((row) => ({
        id: row.querySelector('[data-network-id]').value,
        name: row.querySelector('[data-network-name]').value,
        address: row.querySelector('[data-network-address]').value,
      }));
    });
    try {
      await Dae.api('/api/admin/settings', {
        method: 'PUT', admin: true,
        body: JSON.stringify({
          paymentNumbers: { mtn: form.elements.paymentMtn.value, airtel: form.elements.paymentAirtel.value },
          paymentInstructions: form.elements.paymentInstructions.value,
          contactWhatsApp: form.elements.contactWhatsApp.value,
          contactEmail: form.elements.contactEmail.value,
          networks,
        }),
      });
      notice('Coordonnées enregistrées.');
    } catch (error) {
      notice(error.message, true);
    }
  });

  document.getElementById('network-addresses').addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-add-network]');
    if (addButton) {
      appendNetwork(addButton.dataset.addNetwork, {});
      return;
    }
    const removeButton = event.target.closest('[data-remove-network]');
    if (!removeButton) return;
    const list = removeButton.closest('[data-network-list]');
    if (list.children.length <= 3) {
      notice('Conservez au moins trois réseaux pour chaque crypto.', true);
      return;
    }
    removeButton.closest('[data-network-row]').remove();
  });

  if (sessionStorage.getItem('dae-admin-session')) loadAdmin();
})();
