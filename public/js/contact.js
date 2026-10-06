(async function () {
  let config;
  const whatsapp = document.getElementById('whatsapp-link');
  const email = document.getElementById('email-link');
  const unavailable = document.getElementById('contact-unavailable');

  try {
    config = await Dae.api('/api/config');
    if (config.contactWhatsApp) {
      whatsapp.href = `https://wa.me/${config.contactWhatsApp.replace(/\D/g, '')}`;
      document.getElementById('whatsapp-number').textContent = config.contactWhatsApp;
      whatsapp.classList.remove('hidden');
    }
    if (config.contactEmail) {
      email.href = `mailto:${config.contactEmail}`;
      document.getElementById('email-address').textContent = config.contactEmail;
      email.classList.remove('hidden');
    }
    unavailable.classList.toggle('hidden', Boolean(config.contactWhatsApp || config.contactEmail));
  } catch (error) {
    unavailable.textContent = `Les coordonnées sont indisponibles : ${error.message}`;
    unavailable.classList.remove('hidden');
  }

  document.getElementById('contact-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const notice = document.getElementById('contact-error');
    const submit = form.querySelector('button[type="submit"], button:not([type])');
    notice.classList.add('hidden');
    submit.disabled = true;
    submit.textContent = 'Envoi en cours…';
    try {
      await Dae.api('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          name: form.elements.name.value,
          email: form.elements.email.value,
          message: form.elements.message.value,
        }),
      });
      notice.textContent = 'Votre message a bien été envoyé à notre équipe.';
      notice.className = 'mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800';
      form.reset();
    } catch (error) {
      notice.textContent = error.message;
      notice.className = 'mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Envoyer le message';
    }
  });
})();
