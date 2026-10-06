const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function sendEmail({ to, subject, text, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'DAE Crypto';
  if (!apiKey || !senderEmail || !to) {
    throw new Error('BREVO_API_KEY, BREVO_SENDER_EMAIL et une adresse destinataire doivent être configurés');
  }

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
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
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
  const text = [
    `Bonjour,`,
    ``,
    `Votre demande de ${action.toLowerCase()} ${order.asset} a bien été reçue.`,
    `Référence : ${order.ref}`,
    `Montant : ${order.amountCrypto} ${order.asset}`,
    `Valeur estimée : ${order.amountXaf} FCFA`,
    `Réseau : ${order.networkName || order.network}`,
    ``,
    `Votre opération est en attente de vérification. Vous recevrez un autre e-mail lorsque son statut sera mis à jour.`,
    `DAE Crypto`,
  ].join('\n');
  return sendEmail({
    to: order.email,
    subject: `Demande ${action.toLowerCase()} reçue — ${order.ref}`,
    text,
    html: `<p>Bonjour,</p><p>Votre demande de ${escapeHtml(action.toLowerCase())} <strong>${escapeHtml(order.asset)}</strong> a bien été reçue.</p><ul><li>Référence : ${escapeHtml(order.ref)}</li><li>Montant : ${escapeHtml(order.amountCrypto)} ${escapeHtml(order.asset)}</li><li>Valeur estimée : ${escapeHtml(order.amountXaf)} FCFA</li><li>Réseau : ${escapeHtml(order.networkName || order.network)}</li></ul><p>Votre opération est en attente de vérification. Vous recevrez un autre e-mail lorsque son statut sera mis à jour.</p><p>DAE Crypto</p>`,
  });
}

function orderStatusChanged(order, status) {
  const messages = {
    processing: ['confirmée et en cours de traitement', 'Votre demande a été confirmée et notre équipe traite votre opération.'],
    completed: ['terminée', 'Votre opération est confirmée et terminée.'],
    cancelled: ['refusée ou annulée', 'Votre opération n’a pas été confirmée ou a été annulée. Si vous avez déjà payé ou envoyé vos cryptos, contactez notre équipe en indiquant votre référence.'],
    failed: ['échouée', 'Nous n’avons pas pu finaliser votre opération. Contactez notre équipe en indiquant votre référence.'],
  };
  const message = messages[status];
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
    html: `<h2>Nouveau message du formulaire de contact</h2><p><strong>Nom :</strong> ${escapeHtml(name)}</p><p><strong>E-mail :</strong> ${escapeHtml(email)}</p><p><strong>Message :</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
  });
}

module.exports = { sendEmail, orderSubmitted, orderStatusChanged, contactMessage };
