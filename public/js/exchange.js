(function () {
  const form = document.getElementById('exchange-form');
  if (!form) return;

  const mode = form.dataset.mode;
  const steps = [...form.querySelectorAll('[data-step]')];
  const labels = [...document.querySelectorAll('[data-step-label]')];
  const assetSelect = form.elements.asset;
  const networkSelect = form.elements.network;
  const amountInput = form.elements.amount;
  const operatorSelect = form.elements.operator;
  const nextButton = document.getElementById('next-step');
  const backButton = document.getElementById('back-step');
  const submitButton = document.getElementById('submit-order');
  const errorBox = document.getElementById('exchange-error');
  const quoteValue = document.getElementById('quote-value');
  const quoteRate = document.getElementById('quote-rate');
  const assetPicker = document.getElementById('asset-picker');
  let config;
  let exchangeRate;
  let markets = new Map();
  let marketsStale = false;
  let currentStep = 1;
  const cryptoLogos = {
    USDT: 'https://cdn.simpleicons.org/tether/26A17B',
    BTC: 'https://cdn.simpleicons.org/bitcoin/F7931A',
    POL: 'https://cdn.simpleicons.org/polygon/8247E5',
    ETH: 'https://cdn.simpleicons.org/ethereum/627EEA',
    SOL: 'https://cdn.simpleicons.org/solana/9945FF',
  };

  function logoImage(src, alt, className) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = alt;
    image.referrerPolicy = 'no-referrer';
    image.className = className;
    image.addEventListener('error', () => {
      image.replaceWith(document.createTextNode(alt.slice(0, 1)));
    }, { once: true });
    return image;
  }

  function renderAssetPicker() {
    assetPicker.replaceChildren();
    for (const asset of config.assets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.asset = asset.id;
      button.className = 'flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-brand aria-pressed:border-brand aria-pressed:bg-emerald-50';
      button.setAttribute('aria-pressed', String(assetSelect.value === asset.id));
      button.disabled = !markets.has(asset.id) || asset.networks.length === 0;
      button.append(logoImage(cryptoLogos[asset.id], asset.id, 'h-9 w-9 shrink-0 rounded-full bg-white object-contain p-1'));
      const labels = document.createElement('span');
      labels.className = 'min-w-0';
      labels.innerHTML = `<span class="block font-bold">${Dae.escapeHTML(asset.id)}</span><span class="block truncate text-xs font-normal text-slate-500">${Dae.escapeHTML(asset.name)}</span>`;
      button.append(labels);
      button.addEventListener('click', () => {
        assetSelect.value = asset.id;
        assetPicker.querySelectorAll('[data-asset]').forEach((choice) => {
          choice.setAttribute('aria-pressed', String(choice.dataset.asset === asset.id));
        });
        fillNetworks();
      });
      assetPicker.append(button);
    }

    form.querySelectorAll('[name="operator"] + img').forEach((image) => {
      image.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'w-12 text-center text-xs font-black';
        fallback.textContent = image.previousElementSibling.value === 'mtn' ? 'MTN' : 'Airtel';
        image.replaceWith(fallback);
      }, { once: true });
    });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  function selectedAsset() {
    return config?.assets.find((asset) => asset.id === assetSelect.value);
  }

  function currentPrice() {
    return markets.get(assetSelect.value);
  }

  function calculate() {
    const amount = Number(amountInput.value);
    const price = assetSelect.value === 'USDT' ? 1 : currentPrice()?.priceUsd;
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0 || !exchangeRate) {
      return null;
    }
    const amountUsdt = mode === 'buy' ? amount : amount * price;
    const amountCrypto = mode === 'buy' ? amountUsdt / price : amount;
    return {
      amount,
      amountUsdt,
      amountCrypto,
      amountXaf: mode === 'buy'
        ? Math.ceil(amountUsdt * exchangeRate.usdtXafRate)
        : Math.floor(amountUsdt * exchangeRate.usdtXafRate),
      priceUsd: price,
    };
  }

  function buildSummary() {
    const quote = calculate();
    if (!quote) return '<p>Le cours est indisponible pour le moment.</p>';
    const network = selectedAsset()?.networks.find((item) => item.id === networkSelect.value)?.name || networkSelect.value;
    return `<p><strong>Actif :</strong> ${Dae.escapeHTML(assetSelect.value)}</p>
      <p class="mt-2"><strong>Montant en crypto :</strong> ${Dae.escapeHTML(Dae.formatCrypto(quote.amountCrypto))} ${Dae.escapeHTML(assetSelect.value)}</p>
      <p class="mt-2"><strong>Valeur estimée :</strong> ${Dae.escapeHTML(Dae.formatCrypto(quote.amountUsdt, 4))} USDT</p>
      <p class="mt-2"><strong>Réseau :</strong> ${Dae.escapeHTML(network)}</p>
      <p class="mt-2"><strong>Taux de conversion :</strong> 1 USDT = ${Dae.escapeHTML(Dae.formatXaf(exchangeRate.usdtXafRate))}</p>
      <p class="mt-2 text-base"><strong>${mode === 'buy' ? 'Total à payer' : 'Total à recevoir'}</strong> : ${Dae.escapeHTML(Dae.formatXaf(quote.amountXaf))}</p>`;
  }

  function updateQuote() {
    const quote = calculate();
    const price = currentPrice() || (assetSelect.value === 'USDT' ? { priceUsd: 1 } : null);
    const staleNotice = marketsStale ? ' · cours en cache, vérifiez le prix avant de continuer' : '';
    if (!quote || !price) {
      quoteValue.textContent = '—';
      if (mode === 'sell') document.getElementById('quote-usdt').textContent = '— USDT';
      quoteRate.textContent = (price ? 'Saisissez un montant valide.' : 'Cours CoinGecko indisponible.') + staleNotice;
      return;
    }
    if (mode === 'buy') {
      document.getElementById('quote-crypto').textContent =
        `${Dae.formatCrypto(quote.amountCrypto)} ${assetSelect.value}`;
      quoteValue.textContent = Dae.formatXaf(quote.amountXaf);
      const unitPrice = assetSelect.value === 'USDT' ? 1 : price.priceUsd;
      quoteRate.textContent = `1 ${assetSelect.value} = ${Dae.formatCrypto(unitPrice, unitPrice < 1 ? 6 : 2)} USD · taux de conversion : 1 USDT = ${Dae.formatXaf(exchangeRate.usdtXafRate)}${staleNotice}`;
    } else {
      document.getElementById('quote-usdt').textContent =
        `${Dae.formatCrypto(quote.amountUsdt, 4)} USDT`;
      quoteValue.textContent = Dae.formatXaf(quote.amountXaf);
      const unitPrice = assetSelect.value === 'USDT' ? 1 : price.priceUsd;
      quoteRate.textContent = `1 ${assetSelect.value} = ${Dae.formatCrypto(unitPrice, unitPrice < 1 ? 6 : 2)} USD · taux de conversion : 1 USDT = ${Dae.formatXaf(exchangeRate.usdtXafRate)}${staleNotice}`;
    }
  }

  function updateWalletLimit() {
    if (mode === 'buy') {
      form.elements.wallet.maxLength = networkSelect.selectedOptions[0]?.textContent.toLowerCase().includes('lightning')
        ? 7100
        : 2000;
    }
  }

  function fillNetworks() {
    const asset = selectedAsset();
    const oldNetwork = networkSelect.value;
    const available = asset?.networks || [];
    networkSelect.innerHTML = '<option value="">Choisir un réseau</option>' + available.map(
      (network) => `<option value="${Dae.escapeHTML(network.id)}">${Dae.escapeHTML(network.name)}</option>`
    ).join('');
    if (available.some((network) => network.id === oldNetwork)) networkSelect.value = oldNetwork;
    if (!available.length && asset) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Aucun réseau disponible — contactez-nous';
      networkSelect.appendChild(option);
    }
    updateWalletLimit();
    updateQuote();
    updatePaymentDetails();
  }

  function updatePaymentDetails() {
    if (!config) return;
    if (mode === 'buy') {
      document.getElementById('pay-destination').textContent =
        config.paymentNumbers?.[operatorSelect.value] || 'Numéro Mobile Money non configuré';
      document.getElementById('pay-instructions').textContent = config.paymentInstructions || '';
      document.getElementById('buy-summary').innerHTML = buildSummary();
    } else {
      const network = selectedAsset()?.networks.find((item) => item.id === networkSelect.value);
      document.getElementById('deposit-address').textContent = network?.address || 'Adresse de réception non configurée';
      document.getElementById('deposit-address').dataset.address = network?.address || '';
      document.getElementById('sell-summary').innerHTML = buildSummary();
    }
  }

  function setStep(step) {
    currentStep = step;
    steps.forEach((item) => item.classList.toggle('hidden', Number(item.dataset.step) !== step));
    labels.forEach((item) => {
      const active = Number(item.dataset.stepLabel) === step;
      item.className = `rounded-xl px-3 py-3 text-center ${active ? 'bg-brand text-white' : 'bg-white text-slate-500'}`;
    });
    backButton.classList.toggle('hidden', step === 1);
    nextButton.classList.toggle('hidden', step === 3);
    submitButton.classList.toggle('hidden', step !== 3);
    clearError();
    if (step === 3) {
      document.getElementById('final-summary').innerHTML = buildSummary();
      updatePaymentDetails();
    }
    window.scrollTo({ top: form.offsetTop - 20, behavior: 'smooth' });
  }

  function validateQuote() {
    if (!assetSelect.value) {
      showError('Choisissez une crypto.');
      return false;
    }
    const fields = [...steps[0].querySelectorAll('select, input')].filter((field) => field !== assetSelect);
    if (!fields.every((field) => field.reportValidity())) return false;
    const quote = calculate();
    if (!quote || !exchangeRate) {
      showError('Les cours ne sont pas encore disponibles. Réessayez dans un instant.');
      return false;
    }
    const minXaf = mode === 'buy' ? exchangeRate.buyMinXaf : exchangeRate.sellMinXaf;
    const maxXaf = mode === 'buy' ? exchangeRate.buyMaxXaf : exchangeRate.sellMaxXaf;
    if (quote.amountXaf < minXaf || quote.amountXaf > maxXaf) {
      showError(`Le montant de ${mode === 'buy' ? 'l’achat' : 'la vente'} doit être compris entre ${Dae.formatXaf(minXaf)} et ${Dae.formatXaf(maxXaf)}.`);
      return false;
    }
    return true;
  }

  async function imageData(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choisissez une image JPEG, PNG ou WebP.');
    if (file.size > 5 * 1024 * 1024) throw new Error('La capture doit faire 5 Mo maximum.');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Impossible de lire la capture.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('La capture sélectionnée est illisible.'));
      element.src = source;
    });
    const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossible de préparer la capture pour son envoi.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL('image/jpeg', 0.72);
    if (compressed.length > 1_500_000) throw new Error('La capture reste trop volumineuse après optimisation.');
    return compressed;
  }

  nextButton.addEventListener('click', () => {
    clearError();
    if (currentStep === 1 && validateQuote()) {
      updatePaymentDetails();
      setStep(2);
      return;
    }
    if (currentStep !== 2) return;
    const fields = mode === 'buy'
      ? [form.elements.wallet, form.elements.phone, form.elements.email]
      : [form.elements.phone, form.elements.email];
    if (!operatorSelect.value || !fields.every((field) => field.reportValidity())) {
      if (!operatorSelect.value) showError('Choisissez un moyen de paiement Mobile Money.');
      return;
    }
    const quote = calculate();
    const minXaf = mode === 'buy' ? exchangeRate.buyMinXaf : exchangeRate.sellMinXaf;
    const maxXaf = mode === 'buy' ? exchangeRate.buyMaxXaf : exchangeRate.sellMaxXaf;
    if (quote.amountXaf < minXaf || quote.amountXaf > maxXaf) {
      showError(`Le montant de ${mode === 'buy' ? 'l’achat' : 'la vente'} doit être compris entre ${Dae.formatXaf(minXaf)} et ${Dae.formatXaf(maxXaf)}.`);
      return;
    }
    const network = selectedAsset()?.networks.find((item) => item.id === networkSelect.value);
    const ready = mode === 'buy'
      ? Boolean(config.paymentNumbers?.[operatorSelect.value])
      : Boolean(network?.address);
    if (!ready) {
      showError(mode === 'buy'
        ? 'Le numéro de paiement choisi n’est pas encore configuré.'
        : 'Cette adresse de dépôt n’est pas encore configurée.');
      return;
    }
    updatePaymentDetails();
    setStep(3);
  });

  backButton.addEventListener('click', () => setStep(currentStep - 1));
  assetSelect.addEventListener('change', fillNetworks);
  networkSelect.addEventListener('change', () => {
    updateWalletLimit();
    updatePaymentDetails();
  });
  amountInput.addEventListener('input', () => {
    updateQuote();
    updatePaymentDetails();
  });
  form.querySelectorAll('[name="operator"]').forEach((input) => {
    input.addEventListener('change', updatePaymentDetails);
  });

  const copyButton = document.getElementById('copy-address');
  copyButton?.addEventListener('click', async () => {
    const address = document.getElementById('deposit-address').dataset.address;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      copyButton.textContent = 'Adresse copiée';
    } catch {
      showError('Copie impossible sur ce navigateur. Sélectionnez l’adresse manuellement.');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    if (currentStep !== 3) return;
    const proofFields = [form.elements.proofImage, form.elements.proof, form.elements.consent];
    if (!proofFields.every((field) => field.reportValidity())) return;
    const quote = calculate();
    const minXaf = mode === 'buy' ? exchangeRate.buyMinXaf : exchangeRate.sellMinXaf;
    const maxXaf = mode === 'buy' ? exchangeRate.buyMaxXaf : exchangeRate.sellMaxXaf;
    if (!quote || quote.amountXaf < minXaf || quote.amountXaf > maxXaf) {
      showError('Le montant n’est plus dans les limites autorisées. Revenez à l’étape précédente.');
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Envoi en cours…';
    try {
      const proofImage = await imageData(form.elements.proofImage.files[0]);
      const order = await Dae.api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          asset: assetSelect.value,
          amount: mode === 'buy' ? quote.amountUsdt : quote.amountCrypto,
          network: networkSelect.value,
          operator: operatorSelect.value,
          phone: form.elements.phone.value,
          email: form.elements.email.value,
          wallet: mode === 'buy' ? form.elements.wallet.value : undefined,
          proof: form.elements.proof.value,
          proofImage,
        }),
      });
      const emailNotice = order.notificationSent ? '' : '&notification=failed';
      window.location.assign(`/attente.html?ref=${encodeURIComponent(order.ref)}${emailNotice}`);
    } catch (error) {
      showError(error.message);
      submitButton.disabled = false;
      submitButton.textContent = 'Envoyer et suivre ma commande';
    }
  });

  (async () => {
    try {
      const [loadedConfig, rates, marketData] = await Promise.all([
        Dae.api('/api/config'),
        Dae.api('/api/rates'),
        Dae.api('/api/markets'),
      ]);
      config = loadedConfig;
      exchangeRate = rates;
      markets = new Map(marketData.markets.map((market) => [market.asset, market]));
      marketsStale = marketData.stale;
      renderAssetPicker();
      fillNetworks();
      window.setInterval(async () => {
        try {
          const latest = await Dae.api('/api/markets');
          markets = new Map(latest.markets.map((market) => [market.asset, market]));
          marketsStale = latest.stale;
          updateQuote();
          updatePaymentDetails();
        } catch {
          quoteRate.textContent = 'Actualisation du cours impossible. Le cours affiché peut avoir changé.';
        }
      }, 60_000);
    } catch (error) {
      showError(`Impossible de charger les réseaux ou les cours : ${error.message}`);
    }
  })();
})();
