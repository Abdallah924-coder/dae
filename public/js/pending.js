(function () {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  const statusText = {
    created: 'Commande créée. Nous attendons la déclaration de votre paiement.',
    payment_declared: 'Preuve reçue. Votre paiement est en attente de vérification.',
    processing: 'Paiement validé. Votre opération est en cours de traitement.',
    completed: 'Opération terminée. Merci d’avoir choisi DAE Crypto.',
    cancelled: 'Cette commande a été refusée ou annulée. Contactez-nous si vous avez déjà payé.',
    expired: 'Cette commande a expiré. Contactez-nous avant de refaire un paiement.',
    failed: 'Le traitement de cette commande a échoué. Contactez notre équipe.',
  };
  const terminal = new Set(['completed', 'cancelled', 'expired', 'failed']);
  const error = document.getElementById('pending-error');
  const details = document.getElementById('order-details');
  const emailNotice = document.getElementById('email-notice');

  if (params.get('notification') === 'failed') {
    emailNotice.textContent = 'Votre commande a bien été créée, mais l’e-mail de confirmation n’a pas pu être envoyé. Gardez votre référence de commande et contactez-nous si nécessaire.';
    emailNotice.classList.remove('hidden');
  }

  function showError(message) {
    error.textContent = message;
    error.classList.remove('hidden');
  }

  async function loadOrder(orderRef) {
    error.classList.add('hidden');
    try {
      const order = await Dae.api(`/api/orders/${encodeURIComponent(orderRef)}`);
      document.getElementById('pending-title').textContent = `Commande ${order.ref}`;
      document.getElementById('pending-status').textContent = statusText[order.status] || `Statut : ${order.status}`;
      details.innerHTML = `<p><strong>Opération :</strong> ${order.mode === 'buy' ? 'Achat' : 'Vente'} ${Dae.escapeHTML(order.asset || 'USDT')}</p>
        <p class="mt-2"><strong>Montant crypto :</strong> ${Dae.escapeHTML(Dae.formatCrypto(order.amountCrypto ?? order.amountUsdt))} ${Dae.escapeHTML(order.asset || 'USDT')}</p>
        <p class="mt-2"><strong>Valeur estimée :</strong> ${Dae.escapeHTML(Dae.formatCrypto(order.amountUsdt, 4))} USDT</p>
        <p class="mt-2"><strong>Équivalent :</strong> ${Dae.escapeHTML(Dae.formatXaf(order.amountXaf))}</p>
        <p class="mt-2"><strong>Réseau :</strong> ${Dae.escapeHTML(order.networkName || order.network)}</p>
        <p class="mt-2"><strong>Créée le :</strong> ${Dae.escapeHTML(new Date(order.createdAt).toLocaleString('fr-FR'))}</p>`;
      details.classList.remove('hidden');
      if (!terminal.has(order.status)) window.setTimeout(() => loadOrder(orderRef), 10000);
    } catch (err) {
      showError(err.message);
    }
  }

  if (ref) loadOrder(ref);
  else document.getElementById('reference-form-wrap').classList.remove('hidden');

  document.getElementById('reference-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = document.getElementById('reference-input').value.trim();
    if (value) {
      window.history.replaceState({}, '', `/attente?ref=${encodeURIComponent(value)}`);
      loadOrder(value);
    }
  });
})();
