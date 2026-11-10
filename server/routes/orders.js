'use strict';
const express = require('express');
const crypto = require('crypto');
const Rate = require('../models/Rate');
const Order = require('../models/Order');
const SiteConfig = require('../models/SiteConfig');
const assets = require('../config/cryptoAssets');
const { getMarketPrices } = require('../services/marketData');
const { orderSubmitted, orderReceivedByAdmin } = require('../services/email');
const { normalizePhoneNumber, sendSMS } = require('../services/infobip');
const { logger } = require('../lib/logger');
const { config } = require('../config/index');
const { calculateOrderQuote, decimalToScaled } = require('../services/orderQuote');
const customerAuth = require('../middleware/customerAuth');
const customerAuthService = require('../services/customerAuth');
const { hashOrderReference } = require('../lib/requestLog');
const { createOrderWithEvent, transitionOrder } = require('../services/orderLifecycle');

const router = express.Router();
const HOLD_MINUTES = config.order.holdMinutes;
const PHONE_RE = /^\+?\d{8,15}$/;
const NETWORK_NOT_CONFIGURED = 'Les transferts sur ce réseau sont temporairement indisponibles.';
const QUOTE_TTL_MS = 5 * 60_000;
function optionalCustomerAuth(req, res, next) {
  const token = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dae_customer_session='));
  if (!token) return next();
  return customerAuth(req, res, next);
}

function orderAccessAllowed(req, order) {
  return !order.customerId || String(order.customerId) === String(req.customer?._id || '');
}

function hashIdempotentOrderRequest(body, customerId) {
  const cryptoTransferMethod = String(body.cryptoTransferMethod || 'network');
  const normalized = {
    customerId: String(customerId),
    mode: String(body.mode || ''),
    asset: String(body.asset || ''),
    amount: String(body.amount ?? '').trim(),
    network:
      cryptoTransferMethod === 'binance_pay'
        ? 'BINANCE_PAY'
        : String(body.network || '').trim(),
    cryptoTransferMethod,
    operator: String(body.operator || ''),
    phone: String(body.phone || '').replace(/\s/g, ''),
    recipientName: String(body.recipientName || '').trim(),
    wallet: String(body.wallet || '').trim(),
    binancePayId: String(body.binancePayId || '').trim(),
    proof: String(body.proof || '').trim(),
    proofImage: String(body.proofImage || ''),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function publicView(o) {
  const decimal = (value, fallback = null) => {
    const selected = value ?? fallback;
    return selected == null ? null : String(selected);
  };
  return {
    ref: o.ref,
    mode: o.mode,
    asset: o.asset || 'USDT',
    fulfillment: o.fulfillment || 'external_wallet',
    amountCrypto: decimal(o.amountCrypto, o.amountUsdt),
    unitPriceUsd: decimal(o.unitPriceUsd, '1'),
    amountXaf: o.amountXaf,
    amountUsdt: decimal(o.amountUsdt, o.amountCrypto),
    rateApplied: o.rateApplied,
    network: o.network,
    networkName: o.networkName || o.network,
    cryptoTransferMethod: o.cryptoTransferMethod || 'network',
    binancePayId: o.binancePayId || '',
    receivingAddress: o.mode === 'sell' ? o.receivingAddress || '' : '',
    operator: o.operator,
    status: o.status,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
  };
}

async function expireIfNeeded(order) {
  const now = new Date();
  if (order.status === 'created' && order.expiresAt <= now) {
    const expired = await transitionOrder({
      orderId: order._id,
      expectedStatus: 'created',
      nextStatus: 'expired',
      actorType: 'system',
      expiresAfter: now,
    });
    if (expired) {
      return expired;
    }
    return (await Order.findById(order._id)) || order;
  }
  return order;
}

function quoteFailure(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function currentOrderQuote(mode, asset, amount) {
  const rateDocument = await Rate.findOne({
    $or: [{ asset: 'USDT' }, { asset: { $exists: false } }],
  }).sort({ createdAt: -1, _id: -1 });
  const rate = mode === 'buy'
    ? (rateDocument?.buyRate ?? 635)
    : (rateDocument?.sellRate ?? 580);
  const minXaf = mode === 'buy'
    ? (rateDocument?.buyMinXaf ?? rateDocument?.minXaf ?? 10000)
    : (rateDocument?.sellMinXaf ?? rateDocument?.minXaf ?? 10000);
  const maxXaf = mode === 'buy'
    ? (rateDocument?.buyMaxXaf ?? rateDocument?.maxXaf ?? 500000)
    : (rateDocument?.sellMaxXaf ?? rateDocument?.maxXaf ?? 500000);
  if (
    !Number.isSafeInteger(rate) || rate <= 0 ||
    !Number.isSafeInteger(minXaf) || !Number.isSafeInteger(maxXaf) ||
    minXaf < 0 || maxXaf < minXaf
  ) {
    throw quoteFailure(503, 'Les cotations sont temporairement indisponibles. Réessayez plus tard.');
  }
  let markets;
  try {
    ({ markets } = await getMarketPrices({ allowStale: false }));
  } catch {
    throw quoteFailure(503, 'Cours crypto indisponible, réessayez dans quelques instants');
  }
  const marketPrice = markets.find((item) => item.asset === asset.id)?.priceUsd;
  const unitPriceUsd = asset.id === 'USDT' ? 1 : marketPrice;
  if (!Number.isFinite(unitPriceUsd) || unitPriceUsd <= 0) {
    throw quoteFailure(503, 'Cours crypto indisponible, réessayez dans quelques instants');
  }
  let quote;
  try {
    quote = calculateOrderQuote({ mode, amount, unitPriceUsd, rate });
  } catch (error) {
    throw quoteFailure(400, error.message || 'Montant invalide');
  }
  if (quote.amountXaf < minXaf || quote.amountXaf > maxXaf) {
    throw quoteFailure(400, `Montant hors limites (${minXaf} à ${maxXaf} FCFA)`);
  }
  return { ...quote, minXaf, maxXaf };
}

function quoteSigningKey() {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  if (secret.length < 32) throw new Error('La clé de signature des cotations n’est pas configurée');
  return crypto.createHmac('sha256', secret).update('dae:order-quote:v1').digest();
}

function signOrderQuote({ mode, asset, amount, quote }) {
  const payload = {
    v: 1,
    mode,
    asset: asset.id,
    inputAtomic: decimalToScaled(amount, 8, 'exact').toString(),
    unitPriceUsd: quote.unitPriceUsd,
    rate: String(quote.rate),
    minXaf: quote.minXaf,
    maxXaf: quote.maxXaf,
    expiresAt: Date.now() + QUOTE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', quoteSigningKey()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readOrderQuote(token, { mode, asset, amount }) {
  if (typeof token !== 'string' || token.length > 2048) {
    throw quoteFailure(400, 'La cotation a expiré. Actualisez le montant.');
  }
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra !== undefined) {
    throw quoteFailure(400, 'Cotation invalide. Actualisez le montant.');
  }
  const expected = crypto.createHmac('sha256', quoteSigningKey()).update(encoded).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw quoteFailure(400, 'Cotation invalide. Actualisez le montant.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw quoteFailure(400, 'Cotation invalide. Actualisez le montant.');
  }
  if (
    payload.v !== 1 || payload.mode !== mode || payload.asset !== asset.id ||
    !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now() ||
    !Number.isSafeInteger(payload.minXaf) || !Number.isSafeInteger(payload.maxXaf)
  ) {
    throw quoteFailure(400, 'La cotation a expiré. Actualisez le montant.');
  }
  let inputAtomic;
  let quote;
  try {
    inputAtomic = decimalToScaled(amount, 8, 'exact').toString();
    if (inputAtomic !== payload.inputAtomic) {
      throw quoteFailure(409, 'Le montant a changé. Actualisez la cotation.');
    }
    quote = calculateOrderQuote({
      mode,
      amount,
      unitPriceUsd: payload.unitPriceUsd,
      rate: payload.rate,
    });
  } catch (error) {
    if (error.status) throw error;
    throw quoteFailure(400, error.message || 'Montant invalide');
  }
  if (quote.amountXaf < payload.minXaf || quote.amountXaf > payload.maxXaf) {
    throw quoteFailure(409, 'La cotation est hors des limites actuelles. Actualisez le montant.');
  }
  return { ...quote, minXaf: payload.minXaf, maxXaf: payload.maxXaf };
}

router.post('/quote', customerAuthService.requireSameOrigin, async (req, res, next) => {
  try {
    const { mode, asset: assetId, amount } = req.body || {};
    const asset = assets.find((item) => item.id === assetId);
    if (!['buy', 'sell'].includes(mode) || !asset) {
      return res.status(400).json({ error: 'Mode ou crypto invalide' });
    }
    const quote = await currentOrderQuote(mode, asset, amount);
    return res.json({
      amountUsdt: quote.amountUsdt,
      amountCrypto: quote.amountCrypto,
      amountXaf: quote.amountXaf,
      xaf: quote.amountXaf,
      rate: quote.rate,
      unitPriceUsd: quote.unitPriceUsd,
      minXaf: quote.minXaf,
      maxXaf: quote.maxXaf,
      quoteToken: signOrderQuote({ mode, asset, amount, quote }),
      quotedAt: new Date(),
      quoteExpiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

// Achat : amount est une valeur en USDT. Vente : amount est une quantité de crypto.
router.post('/', customerAuth, customerAuthService.requireSameOrigin, async (req, res, next) => {
  try {
    const {
      mode,
      asset: assetId,
      amount,
      network,
      operator,
      phone,
      recipientName,
      wallet,
      proof,
      proofImage,
      cryptoTransferMethod: requestedTransferMethod,
      binancePayId,
      quoteToken,
      idempotencyKey,
    } = req.body || {};
    const asset = assets.find((item) => item.id === assetId);
    const cryptoTransferMethod = requestedTransferMethod || 'network';

    if (!['buy', 'sell'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
    if (!asset) return res.status(400).json({ error: 'Crypto invalide' });
    if ((typeof amount !== 'string' && typeof amount !== 'number') || !String(amount).trim())
      return res.status(400).json({ error: 'Montant invalide' });
    if (!['network', 'binance_pay'].includes(cryptoTransferMethod)) {
      return res.status(400).json({ error: 'Mode de transfert crypto invalide' });
    }
    if (
      typeof idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
    ) {
      return res.status(400).json({ error: 'Clé de commande invalide. Rechargez le formulaire.' });
    }
    const idempotencyHash = hashIdempotentOrderRequest(req.body || {}, req.customer._id);
    const previousOrder = await Order.findOne({ customerId: req.customer._id, idempotencyKey });
    if (previousOrder) {
      if (previousOrder.idempotencyHash !== idempotencyHash) {
        return res.status(409).json({
          error: 'Cette clé a déjà créé une commande avec d’autres détails.',
          code: 'ERR_ORDER_IDEMPOTENCY_CONFLICT',
          orderRef: previousOrder.ref,
        });
      }
      return res.json({ ...publicView(previousOrder), duplicate: true });
    }
    const internalBalanceBuy = mode === 'buy' && asset.id === 'USDT';
    const selectedTransferMethod = internalBalanceBuy ? 'network' : cryptoTransferMethod;
    const selectedNetwork = internalBalanceBuy
      ? 'BEP20'
      : selectedTransferMethod === 'binance_pay'
        ? 'BINANCE_PAY'
        : network;
    if (
      typeof selectedNetwork !== 'string' ||
      selectedNetwork.length < 1 ||
      selectedNetwork.length > 40
    ) {
      return res.status(400).json({ error: 'Réseau invalide' });
    }
    if (!['mtn', 'airtel'].includes(operator))
      return res.status(400).json({ error: 'Opérateur invalide' });
    const cleanEmail = req.customer.email;

    const cleanPhone = String(phone || '').replace(/\s/g, '');
    if (!PHONE_RE.test(cleanPhone))
      return res.status(400).json({ error: 'Numéro de téléphone invalide' });
    const cleanRecipientName = String(recipientName || '').trim();
    if (mode === 'sell' && (!cleanRecipientName || cleanRecipientName.length > 100)) {
      return res
        .status(400)
        .json({ error: 'Le nom du bénéficiaire Mobile Money est requis (100 caractères maximum)' });
    }

    const config = await SiteConfig.findOne({ key: 'main' }).lean();
    const configuredNetwork = config?.receivingAddresses?.[asset.id]?.[selectedNetwork];
    const defaultNetwork = asset.networks.find((item) => item.id === selectedNetwork);
    const depositAddress =
      typeof configuredNetwork === 'string' ? configuredNetwork : configuredNetwork?.address;
    if (selectedTransferMethod === 'network' && !configuredNetwork && !defaultNetwork) {
      return res.status(400).json({ error: 'Réseau non pris en charge pour cette crypto' });
    }
    if (mode === 'sell' && selectedTransferMethod === 'network' && !depositAddress?.trim()) {
      return res.status(503).json({ error: NETWORK_NOT_CONFIGURED });
    }
    let cleanWallet;
    let cleanBinancePayId;
    if (mode === 'buy' && !internalBalanceBuy) {
      if (selectedTransferMethod === 'binance_pay') {
        cleanBinancePayId = String(binancePayId || '').trim();
        if (!/^\d{4,32}$/.test(cleanBinancePayId)) {
          return res
            .status(400)
            .json({ error: 'Votre ID Binance doit contenir entre 4 et 32 chiffres' });
        }
      } else {
        cleanWallet = String(wallet || '').trim();
        const networkName =
          typeof configuredNetwork === 'string'
            ? selectedNetwork
            : configuredNetwork?.name || defaultNetwork?.name || selectedNetwork;
        const maxWalletLength = networkName.toLowerCase().includes('lightning') ? 7100 : 2000;
        if (cleanWallet.length < 20 || cleanWallet.length > maxWalletLength) {
          return res.status(400).json({ error: 'Adresse de portefeuille invalide' });
        }
      }
    }
    if (mode === 'sell' && cryptoTransferMethod === 'binance_pay') {
      cleanBinancePayId = String(config?.binancePayId || '').trim();
      if (!/^\d{4,32}$/.test(cleanBinancePayId)) {
        return res.status(503).json({ error: 'Binance Pay est temporairement indisponible.' });
      }
    }
    if (mode === 'buy' && !config?.paymentNumbers?.[operator]) {
      return res
        .status(503)
        .json({ error: 'Ce moyen de paiement est temporairement indisponible.' });
    }

    let quote;
    try {
      quote = quoteToken
        ? readOrderQuote(quoteToken, { mode, asset, amount })
        : await currentOrderQuote(mode, asset, amount);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
    const {
      amountCrypto,
      unitPriceUsd,
      amountXaf,
      amountUsdt,
      rate: unit,
    } = quote;

    const cleanProof = String(proof || '').trim();
    const cleanProofImage = String(proofImage || '');
    if (cleanProof && (cleanProof.length < 6 || cleanProof.length > 200)) {
      return res.status(400).json({ error: 'Référence de paiement invalide' });
    }
    if (
      cleanProofImage &&
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(cleanProofImage)
    ) {
      return res
        .status(400)
        .json({ error: 'La capture doit être une image JPEG, PNG ou WebP valide' });
    }
    if (cleanProofImage.length > 1600000) {
      return res.status(413).json({ error: 'La capture dépasse la taille maximale autorisée' });
    }
    if (Boolean(cleanProof) !== Boolean(cleanProofImage)) {
      return res.status(400).json({ error: 'Ajoutez la référence et la capture du paiement' });
    }

    const orderData = {
      ref: 'CMD-' + crypto.randomBytes(9).toString('base64url'),
      customerId: req.customer._id,
      mode,
      asset: asset.id,
      amountCrypto,
      unitPriceUsd,
      amountXaf,
      amountUsdt,
      rateApplied: unit,
      network: selectedNetwork,
      networkName: internalBalanceBuy
        ? 'Solde DAE · BNB Smart Chain (BEP20)'
        : selectedTransferMethod === 'binance_pay'
          ? 'Binance Pay (transfert interne)'
          : typeof configuredNetwork === 'string'
            ? selectedNetwork
            : configuredNetwork?.name || defaultNetwork?.name || selectedNetwork,
      cryptoTransferMethod: selectedTransferMethod,
      binancePayId: cleanBinancePayId,
      receivingAddress:
        mode === 'sell' && selectedTransferMethod === 'network'
          ? String(depositAddress).trim()
          : undefined,
      fulfillment: internalBalanceBuy ? 'internal_balance' : 'external_wallet',
      operator,
      phone: cleanPhone,
      recipientName: cleanRecipientName || undefined,
      email: cleanEmail,
      wallet: cleanWallet,
      proof: cleanProof || undefined,
      proofImage: cleanProofImage || undefined,
      status: cleanProof ? 'payment_declared' : 'created',
      expiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
      idempotencyKey,
      idempotencyHash,
    };
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        customerId: String(req.customer._id),
        mode,
        asset: asset.id,
        amountCrypto,
        unitPriceUsd,
        amountXaf,
        amountUsdt,
        rateApplied: unit,
        network: selectedNetwork,
        cryptoTransferMethod,
        binancePayId: cleanBinancePayId || null,
        operator,
        phone: cleanPhone,
        recipientName: cleanRecipientName || null,
        wallet: cleanWallet || null,
        proof: cleanProof || null,
        proofImage: cleanProofImage || null,
      }))
      .digest('hex');
    orderData.requestHash = requestHash;
    const created = await createOrderWithEvent(orderData, {
      from: cleanProof ? 'created' : undefined,
      to: cleanProof ? 'payment_declared' : 'created',
      actorType: 'customer',
      actorRef: String(req.customer._id),
    });
    const { order, duplicate } = created;
    if (duplicate) return res.json({ ...publicView(order), duplicate: true });

    const [clientMail, adminMail] = await Promise.allSettled([
      orderSubmitted(order),
      orderReceivedByAdmin(order),
    ]);
    const notificationSent = clientMail.status === 'fulfilled';
    const adminNotificationSent = adminMail.status === 'fulfilled';
    if (!notificationSent) {
      logger.warn(
        { orderRefHash: hashOrderReference(order.ref), err: clientMail.reason },
        'Échec de l’e-mail de réception client',
      );
    }
    if (!adminNotificationSent) {
      logger.warn(
        { orderRefHash: hashOrderReference(order.ref), err: adminMail.reason },
        'Échec de la notification admin',
      );
    }

    const companyName = config.company;
    const smsText = `Votre transaction chez ${companyName} a bien été reçue et est actuellement en attente de traitement. Référence : ${order.ref}. Nous vous informerons dès sa validation.`;
    try {
      const smsResult = await sendSMS(normalizePhoneNumber(order.phone), smsText);
      order.smsStatus = 'sent';
      order.smsMessageId = smsResult?.messages?.[0]?.messageId || smsResult?.messageId || undefined;
      order.smsError = undefined;
      await order.save();
    } catch (error) {
      order.smsStatus = 'failed';
      order.smsError = error.message.slice(0, 500);
      await order.save();
      logger.error(
        { orderRefHash: hashOrderReference(order.ref), err: error },
        'Échec de l’envoi SMS',
      );
    }

    res.status(201).json({
      ...publicView(order),
      notificationSent,
      adminNotificationSent,
    });
  } catch (err) {
    next(err);
  }
});

// Suivi par référence
router.get('/idempotency/:key', customerAuth, async (req, res, next) => {
  try {
    const key = String(req.params.key || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      return res.status(400).json({ error: 'Clé de commande invalide.' });
    }
    const order = await Order.findOne({ customerId: req.customer._id, idempotencyKey: key });
    if (!order) return res.status(404).json({ error: 'Aucune commande trouvée pour cette clé.' });
    return res.json(publicView(order));
  } catch (error) {
    return next(error);
  }
});

router.get('/:ref', optionalCustomerAuth, async (req, res, next) => {
  try {
    const order = await Order.findOne({ ref: String(req.params.ref) });
    if (!order || !orderAccessAllowed(req, order)) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    const currentOrder = await expireIfNeeded(order);
    res.json(publicView(currentOrder));
  } catch (err) {
    next(err);
  }
});

// Le client déclare son paiement (ID de transaction ou hash)
router.patch(
  '/:ref/proof',
  optionalCustomerAuth,
  customerAuthService.requireSameOrigin,
  async (req, res, next) => {
    try {
      const proof = String((req.body || {}).proof || '').trim();
      if (proof.length < 6 || proof.length > 200) {
        return res.status(400).json({ error: 'Preuve de paiement invalide' });
      }
      const proofImage = String((req.body || {}).proofImage || '');
      if (
        !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(proofImage) ||
        proofImage.length > 1600000
      ) {
        return res.status(400).json({ error: 'Capture de paiement invalide' });
      }
      const order = await Order.findOne({ ref: String(req.params.ref) });
      if (!order || !orderAccessAllowed(req, order)) {
        return res.status(404).json({ error: 'Commande introuvable' });
      }
      if (order.status !== 'created') {
        return res.status(409).json({ error: 'Cette commande ne peut plus être modifiée' });
      }
      const now = new Date();
      if (order.expiresAt <= now) {
        await expireIfNeeded(order);
        return res.status(409).json({ error: 'Cette commande a expiré' });
      }
      const updatedOrder = await transitionOrder({
        orderId: order._id,
        expectedStatus: 'created',
        nextStatus: 'payment_declared',
        actorType: req.customer ? 'customer' : 'guest',
        actorRef: req.customer ? String(req.customer._id) : undefined,
        changes: { proof, proofImage },
        validAfter: now,
      });
      if (!updatedOrder) {
        return res.status(409).json({ error: 'Cette commande ne peut plus être modifiée' });
      }
      res.json(publicView(updatedOrder));
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
