'use strict';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
async function sendEmail({ to, subject, text, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'DAE Crypto';
  if (!apiKey || !senderEmail || !to)
    throw new Error(
      'BREVO_API_KEY, BREVO_SENDER_EMAIL et une adresse destinataire doivent être configurés',
    );
  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: to }],
    subject,
    textContent: text,
    htmlContent: html,
  };
  if (replyTo) payload.replyTo = { email: replyTo };
  const response = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Brevo a répondu avec le statut ${response.status}: ${detail}`);
  }
}
function orderSubmitted(order) {
  const action = order.mode === 'buy' ? 'Achat' : 'Vente';
  const transferDetails =
    order.mode === 'sell' && order.cryptoTransferMethod === 'network'
      ? `Envoyez les fonds à l’adresse : ${order.receivingAddress}\nRéseau : ${order.networkName || order.network}`
      : order.cryptoTransferMethod === 'binance_pay'
        ? `Binance Pay · UID ${order.binancePayId}`
        : `Réseau : ${order.networkName || order.network}`;
  const text = `Bonjour,\n\nVotre demande de ${action.toLowerCase()} ${order.asset} a bien été reçue.\nRéférence : ${order.ref}\nMontant : ${order.amountCrypto} ${order.asset}\nValeur estimée : ${order.amountXaf} FCFA\n${transferDetails}\n\nVotre opération est en attente de vérification. Vous recevrez un autre e-mail lorsque son statut sera mis à jour.\nDAE Crypto`;
  return sendEmail({
    to: order.email,
    subject: `Demande ${action.toLowerCase()} reçue — ${order.ref}`,
    text,
    html: `<p>Bonjour,</p><p>Votre demande de ${escapeHtml(action.toLowerCase())} <strong>${escapeHtml(order.asset)}</strong> a bien été reçue.</p><ul><li>Référence : ${escapeHtml(order.ref)}</li><li>Montant : ${escapeHtml(order.amountCrypto)} ${escapeHtml(order.asset)}</li><li>Valeur estimée : ${escapeHtml(order.amountXaf)} FCFA</li><li>${escapeHtml(transferDetails)}</li></ul><p>Votre opération est en attente de vérification. Vous recevrez un autre e-mail lorsque son statut sera mis à jour.</p><p>DAE Crypto</p>`,
  });
}
function orderReceivedByAdmin(order) {
  const action = order.mode === 'buy' ? 'Achat' : 'Vente';
  const publicUrl = (
    process.env.PUBLIC_APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'https://dae-1lpj.onrender.com'
  ).replace(/\/+$/, '');
  const adminUrl = `${publicUrl}/admin`;
  const recipient =
    order.mode === 'sell' ? `\nBénéficiaire Mobile Money : ${order.recipientName}` : '';
  const wallet =
    order.mode === 'buy' && order.fulfillment === 'internal_balance'
      ? '\nDestination : crédit automatique du solde DAE USDT BEP20 lorsque la commande est terminée après vérification du paiement'
      : order.mode === 'buy'
        ? `\nPortefeuille de réception : ${order.wallet}`
        : '';
  const receivingAddress =
    order.mode === 'sell' && order.receivingAddress
      ? `\nAdresse DAE de réception : ${order.receivingAddress}`
      : '';
  const binance =
    order.cryptoTransferMethod === 'binance_pay'
      ? `\nBinance Pay UID destinataire : ${order.binancePayId}`
      : '';
  const text =
    `Nouvelle demande de ${action.toLowerCase()} reçue sur DAE Crypto.\nRéférence : ${order.ref}\nClient : ${order.email}\nTéléphone Mobile Money : ${order.operator} · ${order.phone}${recipient}\nMontant : ${order.amountCrypto} ${order.asset}\nValeur : ${order.amountXaf} FCFA (${order.amountUsdt} USDT)\nRéseau : ${order.networkName || order.network}${wallet}${receivingAddress}${binance}\nPreuve : ${order.proof || 'Non fournie'}\nOuvrir l’administration : ${adminUrl}`
      .filter(Boolean)
      .join('\n');
  return sendEmail({
    to: process.env.ADMIN_EMAIL?.trim(),
    subject: `Nouvelle demande ${action.toLowerCase()} — ${order.ref}`,
    text,
    html: `<h2>Nouvelle demande de ${escapeHtml(action.toLowerCase())}</h2><ul><li>Référence : ${escapeHtml(order.ref)}</li><li>Client : ${escapeHtml(order.email)}</li><li>Mobile Money : ${escapeHtml(order.operator)} · ${escapeHtml(order.phone)}${order.mode === 'sell' ? ` · ${escapeHtml(order.recipientName)}` : ''}</li><li>Montant : ${escapeHtml(order.amountCrypto)} ${escapeHtml(order.asset)}</li><li>Valeur : ${escapeHtml(order.amountXaf)} FCFA (${escapeHtml(order.amountUsdt)} USDT)</li><li>${escapeHtml(order.networkName || order.network)}</li>${order.mode === 'buy' && order.fulfillment === 'internal_balance' ? '<li>Vérifier le paiement réel avant de terminer; la fin de commande crédite automatiquement le solde DAE USDT BEP20.</li>' : ''}${order.mode === 'buy' && order.wallet ? `<li>Portefeuille : ${escapeHtml(order.wallet)}</li>` : ''}${order.mode === 'sell' && order.receivingAddress ? `<li>Adresse de réception DAE : ${escapeHtml(order.receivingAddress)}</li>` : ''}${order.cryptoTransferMethod === 'binance_pay' ? `<li>Binance Pay UID destinataire : ${escapeHtml(order.binancePayId || '')}</li>` : ''}<li>Preuve : ${escapeHtml(order.proof || 'Non fournie')}</li></ul><p><a href="${escapeHtml(adminUrl)}">Ouvrir l’administration</a></p>`,
  });
}
function orderStatusChanged(order, status) {
  const messages = {
    processing: [
      'confirmée et en cours de traitement',
      'Votre demande a été confirmée et notre équipe traite votre opération.',
    ],
    completed: ['terminée', 'Votre opération est confirmée et terminée.'],
    cancelled: [
      'refusée ou annulée',
      'Votre opération n’a pas été confirmée ou a été annulée. Si vous avez déjà payé ou envoyé vos cryptos, contactez notre équipe en indiquant votre référence.',
    ],
    failed: [
      'échouée',
      'Nous n’avons pas pu finaliser votre opération. Contactez notre équipe en indiquant votre référence.',
    ],
  };
  const message =
    status === 'completed' && order.fulfillment === 'internal_balance'
      ? [
          'terminée',
          'Votre paiement a été vérifié et vos USDT ont été crédités sur votre solde DAE BEP20.',
        ]
      : messages[status];
  if (!message) return Promise.resolve();
  const [subjectStatus, explanation] = message;
  const text = `Bonjour,\n\nLe statut de votre demande ${order.ref} (${order.mode === 'buy' ? 'achat' : 'vente'} ${order.asset}) a été mis à jour : ${subjectStatus}.\n\n${explanation}\n\nDAE Crypto`;
  return sendEmail({
    to: order.email,
    subject: `Mise à jour de votre demande — ${order.ref}`,
    text,
    html: `<p>Bonjour,</p><p>Le statut de votre demande <strong>${escapeHtml(order.ref)}</strong> (${escapeHtml(order.mode === 'buy' ? 'achat' : 'vente')} ${escapeHtml(order.asset)}) a été mis à jour : <strong>${escapeHtml(subjectStatus)}</strong>.</p><p>${escapeHtml(explanation)}</p><p>DAE Crypto</p>`,
  });
}
function contactMessage({ name, email, message }) {
  const text = `Message reçu via le formulaire de contact DAE Crypto\n\nNom : ${name}\nE-mail : ${email}\n\nMessage :\n${message}`;
  return sendEmail({
    to: process.env.ADMIN_EMAIL?.trim(),
    replyTo: email,
    subject: `Message du site DAE Crypto — ${name}`,
    text,
    html: `<h2>Nouveau message du formulaire de contact</h2><p><strong>Nom：</strong> ${escapeHtml(name)}</p><p><strong>E-mail：</strong> ${escapeHtml(email)}</p><p><strong>Message：</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
  });
}
function customerVerificationCode({ email, code }) {
  const text = `Votre code de vérification DAE Crypto est ${code}. Il expire dans 10 minutes. Ne le partagez avec personne.`;
  return sendEmail({
    to: email,
    subject: 'Votre code de vérification DAE Crypto',
    text,
    html: `<p>Votre code de vérification DAE Crypto :</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p><p>Il expire dans 10 minutes. Ne le partagez avec personne.</p>`,
  });
}

function depositCreditedEmail({ email, amount, asset, network, reference }) {
  const text = `Bonjour,\n\nVotre dépôt de ${amount} ${asset} sur ${network} a été confirmé et crédité sur votre compte DAE Crypto.\nRéférence : ${reference}\n\nDAE Crypto`;
  return {
    to: email,
    subject: `Dépôt crédité — ${amount} ${asset}`,
    text,
    html: `<p>Bonjour,</p><p>Votre dépôt de <strong>${escapeHtml(amount)} ${escapeHtml(asset)}</strong> sur ${escapeHtml(network)} a été confirmé et crédité sur votre compte.</p><p>Référence : <code>${escapeHtml(reference)}</code></p><p>DAE Crypto</p>`,
  };
}

function withdrawalEmail({ email, amount, asset, status, reference, explanation = '' }) {
  const labels = {
    queued: ['demande reçue', 'Votre demande de retrait est en file de traitement.'],
    completed: ['retrait confirmé', 'Votre retrait est confirmé sur le réseau.'],
    failed: ['retrait échoué', 'Votre retrait a échoué et les fonds réservés ont été libérés sur votre solde.'],
  };
  const [title, defaultExplanation] = labels[status] || ['mise à jour du retrait', 'Le statut de votre retrait a été mis à jour.'];
  const details = explanation || defaultExplanation;
  const text = `Bonjour,\n\n${details}\nMontant : ${amount} ${asset}\nRéférence : ${reference}\n\nDAE Crypto`;
  return {
    to: email,
    subject: `${title} — ${amount} ${asset}`,
    text,
    html: `<p>Bonjour,</p><p>${escapeHtml(details)}</p><p>Montant : <strong>${escapeHtml(amount)} ${escapeHtml(asset)}</strong><br>Référence : <code>${escapeHtml(reference)}</code></p><p>DAE Crypto</p>`,
  };
}

function transferVerificationEmail({ email, code, amount, recipientEmail }) {
  const text = `Confirmez votre envoi de ${amount} USDT à ${recipientEmail} en saisissant ce code : ${code}. Le code expire dans 10 minutes. Ne le partagez avec personne.`;
  return {
    to: email,
    subject: 'Confirmez votre transfert DAE',
    text,
    html: `<p>Confirmez l’envoi de <strong>${escapeHtml(amount)} USDT</strong> à <strong>${escapeHtml(recipientEmail)}</strong>.</p><p>Votre code :</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p><p>Le code expire dans 10 minutes. Ne le partagez avec personne.</p>`,
  };
}

function transferCompletedEmail({ email, direction, amount, fee, counterpartyEmail, reference }) {
  const sent = direction === 'sent';
  const text = sent
    ? `Votre transfert de ${amount} USDT vers ${counterpartyEmail} est terminé. Frais : ${fee} USDT. Référence : ${reference}.`
    : `Vous avez reçu ${amount} USDT de ${counterpartyEmail}. Référence : ${reference}.`;
  return {
    to: email,
    subject: sent ? `Transfert envoyé — ${amount} USDT` : `USDT reçus — ${amount} USDT`,
    text: `${text}\n\nDAE Crypto`,
    html: `<p>${escapeHtml(text)}</p><p>DAE Crypto</p>`,
  };
}

function adminTransferFeeEmail({ email, amount, senderEmail, recipientEmail, reference }) {
  const text = `Commission P2P créditée au compte client administrateur DAE.\nCommission : ${amount} USDT\nExpéditeur : ${senderEmail}\nDestinataire : ${recipientEmail}\nRéférence : ${reference}`;
  return {
    to: email,
    subject: `Nouvelle commission P2P — ${amount} USDT`,
    text,
    html: `<p>Commission P2P créditée au compte client administrateur DAE.</p><p>Commission : <strong>${escapeHtml(amount)} USDT</strong></p><p>Expéditeur : ${escapeHtml(senderEmail)}<br>Destinataire : ${escapeHtml(recipientEmail)}<br>Référence : <code>${escapeHtml(reference)}</code></p>`,
  };
}

module.exports = {
  sendEmail,
  orderSubmitted,
  orderReceivedByAdmin,
  orderStatusChanged,
  contactMessage,
  customerVerificationCode,
  depositCreditedEmail,
  withdrawalEmail,
  transferVerificationEmail,
  transferCompletedEmail,
  adminTransferFeeEmail,
};
