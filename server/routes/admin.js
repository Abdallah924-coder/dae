'use strict';
const express = require('express');
const mongoose = require('mongoose');
const { config } = require('../config');
const adminAuth = require('../middleware/adminAuth');
const Rate = require('../models/Rate');
const Order = require('../models/Order');
const OrderEvent = require('../models/OrderEvent');
const Customer = require('../models/Customer');
const CustomerSession = require('../models/CustomerSession');
const CustomerAuditEvent = require('../models/CustomerAuditEvent');
const CustomerKycAuditEvent = require('../models/CustomerKycAuditEvent');
const SiteConfig = require('../models/SiteConfig');
const EarnConfig = require('../models/EarnConfig');
const EarnConfigChange = require('../models/EarnConfigChange');
const EarnConfigAuditLog = require('../models/EarnConfigAuditLog');
const assets = require('../config/cryptoAssets');
const { orderStatusChanged } = require('../services/email');
const { logger } = require('../lib/logger');
const { hashOrderReference } = require('../lib/requestLog');
const { supportsMultiDocumentTransactions } = require('../services/mongoCapabilities');
const customerAuthService = require('../services/customerAuth');
const { transitionOrder } = require('../services/orderLifecycle');
const { bscConfigStatus, bscDepositsConfigReady, bscWithdrawalsConfigReady } = require('../services/bsc');
const BscTransferJob = require('../models/BscTransferJob');
const BscCollectionRun = require('../models/BscCollectionRun');
const BscSignerHeartbeat = require('../models/BscSignerHeartbeat');
const BscIndexerHeartbeat = require('../models/BscIndexerHeartbeat');
const { Contract, formatEther, formatUnits, getAddress } = require('ethers');
const { getProvider } = require('../services/bsc');
const { configForClient, getEarnConfig, validateEarnConfig } = require('../services/earnConfig');
const { getEarnProtocolStatus } = require('../services/earnProtocols');
const { canResolveEarnChange } = require('../services/earnChangeApproval');

const router = express.Router();
router.post('/auth/login', adminAuth.login);
router.use(adminAuth);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MAX_NETWORKS_PER_ASSET = 12;
const allowedTransitions = {
  created: ['processing', 'cancelled', 'failed'],
  payment_declared: ['processing', 'completed', 'cancelled', 'failed'],
  processing: ['completed', 'cancelled', 'failed'],
  completed: [],
  cancelled: [],
  expired: [],
  failed: [],
};

function configuredNetworks(config, asset) {
  const current = config?.receivingAddresses?.[asset.id] || {};
  if (Object.keys(current).length) {
    return Object.entries(current).map(([id, value]) => ({
      id,
      name:
        typeof value === 'string'
          ? asset.networks.find((network) => network.id === id)?.name || id
          : value.name || id,
      address: typeof value === 'string' ? value : value.address || '',
    }));
  }
  return asset.networks.map((network) => ({ ...network, address: '' }));
}

function mongoTransactionsReady() {
  return supportsMultiDocumentTransactions(mongoose.connection);
}

router.get('/dashboard', async (_req, res, next) => {
  try {
    const groups = await Order.aggregate([
      {
        $group: {
          _id: { mode: '$mode', status: '$status' },
          count: { $sum: 1 },
          amountXaf: { $sum: '$amountXaf' },
        },
      },
    ]);
    const summary = {
      total: { count: 0, amountXaf: 0 },
      buy: {
        count: 0,
        amountXaf: 0,
        completedCount: 0,
        completedXaf: 0,
        pendingCount: 0,
        pendingXaf: 0,
      },
      sell: {
        count: 0,
        amountXaf: 0,
        completedCount: 0,
        completedXaf: 0,
        pendingCount: 0,
        pendingXaf: 0,
      },
      pendingCount: 0,
    };
    for (const group of groups) {
      const side = summary[group._id.mode];
      if (!side) continue;
      summary.total.count += group.count;
      summary.total.amountXaf += group.amountXaf;
      side.count += group.count;
      side.amountXaf += group.amountXaf;
      if (group._id.status === 'completed') {
        side.completedCount += group.count;
        side.completedXaf += group.amountXaf;
      }
      if (['created', 'payment_declared', 'processing'].includes(group._id.status)) {
        summary.pendingCount += group.count;
        side.pendingCount += group.count;
        side.pendingXaf += group.amountXaf;
      }
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/earn/config', async (_req, res, next) => {
  try {
    const config = await getEarnConfig();
    return res.json({
      ...configForClient(config),
      secondAdminConfigured: adminAuth.secondAdminConfigured(),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/earn/audit', async (_req, res, next) => {
  try {
    const events = await EarnConfigAuditLog.find()
      .select('actor action configVersion reason changeId createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(50)
      .lean();
    return res.json({ events });
  } catch (error) {
    return next(error);
  }
});

router.get('/earn/proposals', async (_req, res, next) => {
  try {
    const proposals = await EarnConfigChange.find()
      .select('proposerEmail approverEmail status expectedVersion reason config expiresAt resolvedAt resolutionReason createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(50)
      .lean();
    return res.json({
      proposals: proposals.map((proposal) => ({
        ...proposal,
        status: proposal.status === 'pending' && proposal.expiresAt <= new Date()
          ? 'expired'
          : proposal.status,
        config: configForClient(proposal.config),
      })),
      currentAdmin: _req.adminEmail,
      secondAdminConfigured: adminAuth.secondAdminConfigured(),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/earn/protocols', async (_req, res, next) => {
  try {
    try {
      return res.json(await getEarnProtocolStatus());
    } catch (error) {
      logger.warn({ errorCode: error.code || error.name || 'EARN_RPC_UNAVAILABLE' }, 'Statut RPC des protocoles Earn indisponible');
      return res.json({
        source: 'bsc_rpc_read_only',
        status: 'unavailable',
        errorCode: error.code || error.name || 'EARN_RPC_UNAVAILABLE',
        allocationEnabled: false,
        protocols: {
          venus: { protocol: 'venus', status: 'unavailable', allocationEnabled: false, withdrawalEnabled: false },
          aaveV3: { protocol: 'aaveV3', status: 'unavailable', allocationEnabled: false, withdrawalEnabled: false },
        },
      });
    }
  } catch (error) {
    return next(error);
  }
});

router.post('/earn/proposals', async (req, res, next) => {
  const reason = String(req.body?.reason || '').trim();
  const expectedVersion = req.body?.expectedVersion;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return res.status(400).json({ error: 'Version de configuration requise.' });
  }
  if (reason.length < 8 || reason.length > 300) {
    return res.status(400).json({ error: 'Le motif doit contenir entre 8 et 300 caractères.' });
  }
  let nextConfig;
  try {
    nextConfig = validateEarnConfig(req.body?.config);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!mongoTransactionsReady()) {
    return res.status(503).json({
      error: 'MongoDB en replica set est requis pour enregistrer atomiquement la demande et son audit.',
    });
  }
  if (!adminAuth.secondAdminConfigured()) {
    return res.status(503).json({ error: 'Configurez deux administrateurs indépendants avant de proposer un changement DAE Earn.' });
  }
  const actor = req.adminEmail;
  let session;
  try {
    session = await mongoose.startSession();
    let proposal;
    await session.withTransaction(async () => {
      const current = await EarnConfig.findOne({ key: 'main' }).session(session);
      const currentVersion = current?.configVersion || 0;
      if (currentVersion !== expectedVersion) {
        const conflict = new Error('La configuration a changé. Rechargez-la avant de réessayer.');
        conflict.code = 'ERR_EARN_CONFIG_CONFLICT';
        throw conflict;
      }
      [proposal] = await EarnConfigChange.create([{
        proposerEmail: actor,
        expectedVersion,
        reason,
        config: nextConfig,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }], { session });
      await EarnConfigAuditLog.create([{
        actor,
        action: 'configuration_proposed',
        configVersion: currentVersion + 1,
        reason,
        changeId: proposal._id,
        previousConfig: configForClient(current?.toObject() || null),
        nextConfig: configForClient(nextConfig),
      }], { session });
    });
    return res.status(202).json({
      proposal: {
        id: String(proposal._id),
        status: proposal.status,
        proposerEmail: proposal.proposerEmail,
        expectedVersion: proposal.expectedVersion,
        expiresAt: proposal.expiresAt,
      },
    });
  } catch (error) {
    if (error.code === 'ERR_EARN_CONFIG_CONFLICT') {
      return res.status(409).json({ error: error.message });
    }
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.post('/earn/proposals/:id/approve', async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Identifiant de demande invalide.' });
  if (!adminAuth.secondAdminConfigured()) {
    return res.status(503).json({ error: 'Configurez deux administrateurs indépendants avant toute approbation.' });
  }
  if (!mongoTransactionsReady()) {
    return res.status(503).json({ error: 'MongoDB en replica set est requis pour approuver atomiquement DAE Earn.' });
  }
  const actor = req.adminEmail;
  let session;
  let result;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const proposal = await EarnConfigChange.findOne({
        _id: req.params.id,
        status: 'pending',
      }).session(session);
      if (!proposal) {
        result = { status: 404, error: 'Demande introuvable ou déjà traitée.' };
        return;
      }
      if (proposal.proposerEmail === actor) {
        result = { status: 403, error: 'Un administrateur ne peut pas approuver sa propre demande.' };
        return;
      }
      if (proposal.expiresAt <= new Date()) {
        proposal.status = 'expired';
        proposal.resolvedAt = new Date();
        await proposal.save({ session });
        await EarnConfigAuditLog.create([{
          actor,
          action: 'configuration_rejected',
          configVersion: proposal.expectedVersion + 1,
          reason: 'Demande expirée avant approbation.',
          changeId: proposal._id,
        }], { session });
        result = { status: 410, error: 'La demande a expiré; soumettez une nouvelle configuration.' };
        return;
      }
      if (!canResolveEarnChange(proposal, actor)) {
        result = { status: 403, error: 'Cette demande ne peut pas être approuvée par cette identité.' };
        return;
      }
      const current = await EarnConfig.findOne({ key: 'main' }).session(session);
      const currentVersion = current?.configVersion || 0;
      if (currentVersion !== proposal.expectedVersion) {
        proposal.status = 'rejected';
        proposal.approverEmail = actor;
        proposal.resolvedAt = new Date();
        proposal.resolutionReason = 'La configuration a changé depuis la proposition.';
        await proposal.save({ session });
        await EarnConfigAuditLog.create([{
          actor,
          action: 'configuration_rejected',
          configVersion: currentVersion,
          reason: proposal.resolutionReason,
          changeId: proposal._id,
        }], { session });
        result = { status: 409, error: proposal.resolutionReason };
        return;
      }
      const config = validateEarnConfig(proposal.config);
      const previousConfig = configForClient(current?.toObject() || null);
      let updatedConfig;
      if (current) {
        current.set({ ...config, configVersion: currentVersion + 1, updatedBy: actor });
        updatedConfig = await current.save({ session });
      } else {
        [updatedConfig] = await EarnConfig.create([{
          key: 'main',
          ...config,
          configVersion: 1,
          updatedBy: actor,
        }], { session });
      }
      proposal.status = 'approved';
      proposal.approverEmail = actor;
      proposal.resolvedAt = new Date();
      await proposal.save({ session });
      await EarnConfigAuditLog.create([{
        actor,
        action: 'configuration_approved',
        configVersion: updatedConfig.configVersion,
        reason: proposal.reason,
        changeId: proposal._id,
        previousConfig,
        nextConfig: configForClient(updatedConfig.toObject()),
      }], { session });
      result = { status: 200, config: configForClient(updatedConfig.toObject()) };
    });
    if (result?.error) return res.status(result.status).json({ error: result.error });
    return res.json({ config: result.config });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.post('/earn/proposals/:id/reject', async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Identifiant de demande invalide.' });
  if (!adminAuth.secondAdminConfigured()) {
    return res.status(503).json({ error: 'Configurez deux administrateurs indépendants avant toute décision.' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 8 || reason.length > 300) {
    return res.status(400).json({ error: 'Le motif de refus doit contenir entre 8 et 300 caractères.' });
  }
  if (!mongoTransactionsReady()) {
    return res.status(503).json({ error: 'MongoDB en replica set est requis pour auditer la décision.' });
  }
  const actor = req.adminEmail;
  let session;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const proposal = await EarnConfigChange.findOne({
        _id: req.params.id,
        status: 'pending',
        expiresAt: { $gt: new Date() },
        proposerEmail: { $ne: actor },
      }).session(session);
      if (!canResolveEarnChange(proposal, actor)) return;
      proposal.status = 'rejected';
      proposal.approverEmail = actor;
      proposal.resolvedAt = new Date();
      proposal.resolutionReason = reason;
      await proposal.save({ session });
      const current = await EarnConfig.findOne({ key: 'main' }).select('configVersion').session(session).lean();
      result = proposal;
      await EarnConfigAuditLog.create([{
        actor,
        action: 'configuration_rejected',
        configVersion: current?.configVersion || 0,
        reason,
        changeId: proposal._id,
      }], { session });
    });
    if (!result) return res.status(404).json({ error: 'Demande introuvable, expirée ou vous en êtes le proposant.' });
    return res.json({ id: String(result._id), status: result.status, approverEmail: result.approverEmail });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/customers', async (req, res, next) => {
  try {
    const allowedStatuses = ['pending_verification', 'active', 'locked', 'closed'];
    const allowedKycStatuses = ['not_started', 'pending', 'approved', 'rejected'];
    const status = allowedStatuses.includes(req.query.status) ? req.query.status : '';
    const kycStatus = allowedKycStatuses.includes(req.query.kycStatus) ? req.query.kycStatus : '';
    const search = String(req.query.q || '')
      .trim()
      .slice(0, 100);
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      ...(status ? { status } : {}),
      ...(kycStatus ? { kycStatus } : {}),
      ...(escapedSearch
        ? {
            $or: [
              { email: { $regex: escapedSearch, $options: 'i' } },
              { phone: { $regex: escapedSearch, $options: 'i' } },
              { firstName: { $regex: escapedSearch, $options: 'i' } },
              { lastName: { $regex: escapedSearch, $options: 'i' } },
            ],
          }
        : {}),
    };
    const pageSize = 50;
    const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const filteredTotal = await Customer.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(filteredTotal / pageSize));
    const page = Math.min(requestedPage, pages);
    const [customers, total, active, pendingVerification, kycPending, kycApproved] =
      await Promise.all([
        Customer.find(filter)
          .select(
            'firstName lastName email phone status kycStatus emailVerifiedAt createdAt lastLoginAt',
          )
          .sort({ createdAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        Customer.countDocuments(),
        Customer.countDocuments({ status: 'active' }),
        Customer.countDocuments({ status: 'pending_verification' }),
        Customer.countDocuments({ kycStatus: 'pending' }),
        Customer.countDocuments({ kycStatus: 'approved' }),
      ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      customers,
      summary: { total, active, pendingVerification, kycPending, kycApproved },
      pagination: { page, pageSize, total: filteredTotal, pages },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/customers/:id/status', async (req, res, next) => {
  const customerId = req.params.id;
  const targetStatus = req.body?.status;
  const reason = String(req.body?.reason || '').trim();
  if (!mongoose.isValidObjectId(customerId)) {
    return res.status(400).json({ error: 'Identifiant de compte invalide.' });
  }
  if (!['active', 'locked'].includes(targetStatus)) {
    return res.status(400).json({ error: 'Statut de compte invalide.' });
  }
  if (reason.length < 8 || reason.length > 300) {
    return res.status(400).json({ error: 'Le motif doit contenir entre 8 et 300 caractères.' });
  }
  const fromStatus = targetStatus === 'locked' ? 'active' : 'locked';
  const filter = {
    _id: customerId,
    status: fromStatus,
    emailVerifiedAt: { $ne: null },
  };
  let session;
  let updatedCustomer = null;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      updatedCustomer = null;
      updatedCustomer = await Customer.findOneAndUpdate(
        filter,
        { $set: { status: targetStatus } },
        { new: true, session, runValidators: true },
      ).select('firstName lastName email phone status kycStatus');
      if (!updatedCustomer) return;
      if (targetStatus === 'locked') {
        await CustomerSession.updateMany(
          { customerId, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
      }
      await CustomerAuditEvent.create(
        [{
          customerId,
          actor: process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'admin',
          action: targetStatus === 'locked' ? 'account_locked' : 'account_unlocked',
          fromStatus,
          toStatus: targetStatus,
          reason,
        }],
        { session },
      );
    });
    if (!updatedCustomer) {
      return res.status(409).json({ error: 'Le compte a changé d’état. Actualisez la liste.' });
    }
    return res.json({ customer: updatedCustomer });
  } catch (error) {
    if (/replica set|transaction numbers are only allowed/i.test(error.message || '')) {
      return res.status(503).json({
        error: 'Cette action exige MongoDB en replica set pour garantir une mise à jour auditée atomique.',
      });
    }
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.patch('/customers/:id/kyc', async (req, res, next) => {
  const customerId = req.params.id;
  const targetStatus = String(req.body?.status || '');
  const reason = String(req.body?.reason || '').trim();
  const evidenceReference = String(req.body?.evidenceReference || '').trim();
  if (!mongoose.isValidObjectId(customerId)) return res.status(400).json({ error: 'Identifiant de compte invalide.' });
  if (!['pending', 'approved', 'rejected'].includes(targetStatus)) return res.status(400).json({ error: 'Statut KYC invalide.' });
  if (reason.length < 8 || reason.length > 300) return res.status(400).json({ error: 'Le motif doit contenir entre 8 et 300 caractères.' });
  if (targetStatus === 'approved' && (evidenceReference.length < 3 || evidenceReference.length > 120)) {
    return res.status(400).json({ error: 'Une référence interne au dossier vérifié est requise pour approuver le KYC.' });
  }
  if (targetStatus === 'approved') {
    const contactVerified = await Customer.exists({ _id: customerId, status: 'active', emailVerifiedAt: { $ne: null } });
    if (!contactVerified) return res.status(409).json({ error: 'Le compte doit être actif et son adresse e-mail confirmée.' });
  }
  let session;
  let updatedCustomer;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const current = await Customer.findById(customerId).select('kycStatus').session(session).lean();
      if (!current) return;
      const allowedTransitions = {
        not_started: ['pending'],
        pending: ['approved', 'rejected'],
        rejected: ['pending'],
        approved: ['rejected'],
      };
      if (!allowedTransitions[current.kycStatus]?.includes(targetStatus)) throw new Error('KYC_STATE_CONFLICT');
      updatedCustomer = await Customer.findOneAndUpdate(
        { _id: customerId, kycStatus: current.kycStatus },
        { $set: { kycStatus: targetStatus, kycReviewNote: reason } },
        { new: true, session, runValidators: true },
      ).select('firstName lastName email status kycStatus');
      if (!updatedCustomer) throw new Error('KYC_STATE_CONFLICT');
      await CustomerKycAuditEvent.create([{
        customerId, actor: process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'admin',
        fromStatus: current.kycStatus, toStatus: targetStatus, reason,
        evidenceReference: targetStatus === 'approved' ? evidenceReference : null,
      }], { session });
    });
    if (!updatedCustomer) return res.status(404).json({ error: 'Compte client introuvable.' });
    return res.json({ customer: updatedCustomer });
  } catch (error) {
    if (error.message === 'KYC_STATE_CONFLICT') return res.status(409).json({ error: 'Le statut KYC a changé. Actualisez la liste.' });
    if (/replica set|transaction numbers are only allowed/i.test(error.message || '')) {
      return res.status(503).json({ error: 'MongoDB en replica set est requis pour auditer la revue KYC.' });
    }
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/customers/:id/kyc-audit', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Identifiant de compte invalide.' });
    const events = await CustomerKycAuditEvent.find({ customerId: req.params.id })
      .select('actor fromStatus toStatus reason evidenceReference createdAt').sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ events });
  } catch (error) { return next(error); }
});

router.get('/customers/:id/audit', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant de compte invalide.' });
    }
    const events = await CustomerAuditEvent.find({ customerId: req.params.id })
      .select('actor action fromStatus toStatus reason createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(20)
      .lean();
    return res.json({ events });
  } catch (error) {
    return next(error);
  }
});

router.get('/readiness', async (_req, res, next) => {
  try {
  const [siteConfig, earnConfig] = await Promise.all([
    SiteConfig.findOne({ key: 'main' }).lean(),
    getEarnConfig(),
  ]);
  const earn = configForClient(earnConfig);
  const paymentRails = {
    mtn: Boolean(siteConfig?.paymentNumbers?.mtn?.trim()),
    airtel: Boolean(siteConfig?.paymentNumbers?.airtel?.trim()),
    binancePay: /^\d{4,32}$/.test(String(siteConfig?.binancePayId || '').trim()),
  };
  const emailReady = Boolean(
    process.env.BREVO_API_KEY?.trim() && process.env.BREVO_SENDER_EMAIL?.trim(),
  );
  const authSecretReady = (process.env.CUSTOMER_AUTH_SECRET || '').length >= 32;
  const legalReviewReady = process.env.CUSTOMER_LEGAL_REVIEWED === 'true';
  const accountRegistrationReady =
    emailReady && authSecretReady && legalReviewReady && customerAuthService.publicAppOriginReady();
  res.set('Cache-Control', 'no-store');
  const bsc = bscConfigStatus();
  const signerHeartbeat = await BscSignerHeartbeat.findOne({ name: 'local-bsc-signer', chainId: 56 }).select('lastSeenAt masterAddress gasAddress').lean();
  const signerOnline = Boolean(
    signerHeartbeat &&
    Date.now() - signerHeartbeat.lastSeenAt.getTime() <= 60_000 &&
    signerHeartbeat.masterAddress === config.bsc.masterAddress.toLowerCase() &&
    signerHeartbeat.gasAddress === config.bsc.gasAddress.toLowerCase()
  );
  const indexerHeartbeat = await BscIndexerHeartbeat.findOne({ name: 'bsc-usdt-bep20' }).select('lastSeenAt indexedThrough').lean();
  const indexerOnline = Boolean(indexerHeartbeat && Date.now() - indexerHeartbeat.lastSeenAt.getTime() <= 60_000);
  const transactionsReady = mongoTransactionsReady();
  const depositsReady = bscDepositsConfigReady(bsc) && indexerOnline && transactionsReady;
  const withdrawalsReady = bscWithdrawalsConfigReady(bsc) && signerOnline && transactionsReady;
  res.json({
    accounts: {
      registration: accountRegistrationReady,
      recovery:
        emailReady &&
        authSecretReady &&
        mongoTransactionsReady() &&
        customerAuthService.publicAppOriginReady(),
      email: emailReady,
      sessionSecret: authSecretReady,
      publicAppOrigin: customerAuthService.publicAppOriginReady(),
      legalReview: legalReviewReady,
    },
    database: { transactions: mongoTransactionsReady() },
    identity: { enabled: true, status: 'manual_admin_review' },
    custody: {
      wallets: { enabled: bsc.xpub, status: bsc.xpub ? 'bsc_xpub_configured' : 'bsc_xpub_missing' },
      deposits: {
        enabled: depositsReady,
        status: !bsc.depositsEnabled ? 'deposits_disabled' : !bscDepositsConfigReady(bsc) ? 'bsc_configuration_incomplete' : !transactionsReady ? 'mongo_transactions_required' : indexerOnline ? 'indexer_online' : 'indexer_offline',
      },
      withdrawals: {
        enabled: withdrawalsReady,
        status: !bsc.withdrawalsEnabled ? 'withdrawals_disabled' : !bscWithdrawalsConfigReady(bsc) ? 'bsc_configuration_incomplete' : !transactionsReady ? 'mongo_transactions_required' : signerOnline ? 'signer_online' : 'self_hosted_signer_offline',
      },
      staking: { enabled: false, status: 'earn_not_live' },
    },
    earn: {
      catalogEnabled: true,
      productionEnabled: false,
      subscriptionsEnabled: false,
      allocationsEnabled: false,
      rewardsEnabled: false,
      configVersion: earn.configVersion,
      allocationLimitBps: earn.allocationLimitBps,
      dualApprovalConfigured: adminAuth.secondAdminConfigured(),
    },
    bsc: { configured: bsc.ready, ...bsc, signerOnline, indexerOnline, indexedThrough: indexerHeartbeat?.indexedThrough || null, token: 'Binance-Peg BSC-USD', decimals: 18, chainId: 56 },
    regulatoryReview: process.env.DAE_REGULATORY_REVIEWED === 'true',
    paymentRails,
    manualExchange: {
      enabled: mongoTransactionsReady(),
      status: mongoTransactionsReady() ? 'manual_order_workflow' : 'mongo_transactions_required',
    },
    assetMovementsEnabled: Boolean(depositsReady || withdrawalsReady),
  });
  } catch (error) {
    return next(error);
  }
});

router.post('/custody/bsc/collect', async (req, res, next) => {
  let session;
  try {
    const bsc = bscConfigStatus();
    if (!bsc.sweepsEnabled || !bsc.master || !bsc.gas || !bsc.xpub || !bsc.token) return res.status(503).json({ error: 'La collecte BSC est désactivée ou incomplète dans la configuration opérateur.' });
    const heartbeat = await BscSignerHeartbeat.findOne({ name: 'local-bsc-signer', chainId: 56, masterAddress: config.bsc.masterAddress.toLowerCase(), gasAddress: config.bsc.gasAddress.toLowerCase() }).lean();
    if (!heartbeat || Date.now() - heartbeat.lastSeenAt.getTime() > 60_000) return res.status(503).json({ error: 'Le signataire local DAE est hors ligne.' });
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 8) return res.status(400).json({ error: 'Motif de collecte requis (8 caractères minimum).' });
    const idempotencyKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return res.status(400).json({ error: 'Clé d’idempotence UUID requise.' });
    const existing = await BscCollectionRun.findOne({ idempotencyKey }).lean();
    if (existing) return res.json({ runId: String(existing._id), status: existing.status, walletCount: existing.walletCount });
    const customers = await Customer.find({ status: 'active', kycStatus: 'approved' }).select('_id').lean();
    const wallets = await require('../models/Wallet').find({
      customerId: { $in: customers.map((customer) => customer._id) }, network: 'BEP20', status: 'active', address: { $type: 'string' },
    }).select('_id address').lean();
    if (!wallets.length) return res.status(409).json({ error: 'Aucun portefeuille BSC actif et vérifié à collecter.' });
    if (!mongoTransactionsReady()) return res.status(503).json({ error: 'MongoDB en replica set est requis pour créer une collecte atomique.' });
    session = await mongoose.startSession();
    let run;
    await session.withTransaction(async () => {
      [run] = await BscCollectionRun.create([{
        actor: process.env.ADMIN_EMAIL.trim().toLowerCase(), idempotencyKey,
        reason, walletCount: wallets.length, status: 'queued',
      }], { session });
      await BscTransferJob.insertMany(wallets.map((wallet) => ({
        kind: 'sweep', status: 'queued', idempotencyKey: `bsc-sweep:${idempotencyKey}:${wallet._id}`,
        sourceAddress: wallet.address, destination: config.bsc.masterAddress,
        walletId: wallet._id, collectionRunId: run._id,
      })), { session, ordered: true });
    });
    return res.status(202).json({ runId: String(run._id), status: 'queued', walletCount: wallets.length });
  } catch (error) {
    const idempotencyKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    if (error.code === 11000 && idempotencyKey) {
      const run = await BscCollectionRun.findOne({ idempotencyKey }).lean();
      if (run) return res.json({ runId: String(run._id), status: run.status, walletCount: run.walletCount });
    }
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/custody/bsc/balances', async (_req, res, next) => {
  try {
    const status = bscConfigStatus();
    if (!status.rpc || !status.token || !status.master || !status.gas) {
      return res.json({ available: false, reason: 'Configuration BSC incomplète.' });
    }
    const provider = getProvider();
    const chain = await provider.getNetwork();
    if (Number(chain.chainId) !== 56) return res.status(503).json({ error: 'RPC hors réseau BNB Smart Chain.' });
    const token = new Contract(config.bsc.usdtContract, ['function balanceOf(address) view returns (uint256)'], provider);
    const [masterBnb, gasBnb, masterUsdt, queuedSweeps, lastCollection] = await Promise.all([
      provider.getBalance(getAddress(config.bsc.masterAddress)),
      provider.getBalance(getAddress(config.bsc.gasAddress)),
      token.balanceOf(getAddress(config.bsc.masterAddress)),
      BscTransferJob.countDocuments({ kind: 'sweep', status: { $in: ['queued', 'processing', 'signed', 'broadcast', 'failing'] } }),
      BscCollectionRun.findOne().sort({ createdAt: -1 }).select('status walletCount createdAt actor reason').lean(),
    ]);
    return res.json({
      available: true,
      masterAddress: config.bsc.masterAddress,
      gasAddress: config.bsc.gasAddress,
      masterBnb: formatEther(masterBnb),
      gasBnb: formatEther(gasBnb),
      masterBscUsd: formatUnits(masterUsdt, 18),
      queuedSweeps,
      lastCollection,
      token: 'Binance-Peg BSC-USD',
    });
  } catch (error) { return next(error); }
});

// Recherche et pagination des commandes (filtre ?status=...&q=...&page=...)
router.get('/orders', async (req, res, next) => {
  try {
    const status = Order.STATUSES.includes(req.query.status) ? req.query.status : '';
    const search = String(req.query.q || '')
      .trim()
      .slice(0, 100);
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      ...(status ? { status } : {}),
      ...(escapedSearch
        ? {
            $or: [
              { ref: { $regex: escapedSearch, $options: 'i' } },
              { email: { $regex: escapedSearch, $options: 'i' } },
              { phone: { $regex: escapedSearch, $options: 'i' } },
              { asset: { $regex: escapedSearch, $options: 'i' } },
            ],
          }
        : {}),
    };
    const pageSize = 50;
    const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const total = await Order.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pages);
    const orders = await Order.find(filter)
      .select('-proofImage')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    res.set('Cache-Control', 'no-store');
    res.json({
      orders: orders.map((order) => ({
        ...order,
        amountCrypto: order.amountCrypto == null ? null : String(order.amountCrypto),
        amountUsdt: order.amountUsdt == null ? null : String(order.amountUsdt),
        unitPriceUsd: order.unitPriceUsd == null ? null : String(order.unitPriceUsd),
      })),
      pagination: { page, pageSize, total, pages },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:ref/proof', async (req, res, next) => {
  try {
    const order = await Order.findOne({ ref: String(req.params.ref) }).select('proof proofImage');
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    res.json({ proof: order.proof || '', image: order.proofImage || '' });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:ref/events', async (req, res, next) => {
  try {
    const events = await OrderEvent.find({ orderRef: String(req.params.ref) })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// Changer le statut d'une commande
router.patch('/orders/:ref', async (req, res, next) => {
  try {
    const { status, note } = req.body || {};
    if (!Order.STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
    const order = await Order.findOne({ ref: String(req.params.ref) });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    const from = order.status;
    if (!allowedTransitions[from]?.includes(status)) {
      return res.status(409).json({ error: `Transition impossible : ${from} → ${status}` });
    }
    const updatedOrder = await transitionOrder({
      orderId: order._id,
      expectedStatus: from,
      nextStatus: status,
      actorType: 'admin',
      actorRef: process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'admin',
      note: note ? String(note).trim().slice(0, 300) : undefined,
    });
    if (!updatedOrder) {
      return res.status(409).json({ error: 'La commande a changé entre-temps. Actualisez la liste.' });
    }
    let notificationSent = true;
    if (['processing', 'completed', 'cancelled', 'failed'].includes(status)) {
      try {
        await orderStatusChanged(updatedOrder, status);
      } catch (error) {
        notificationSent = false;
        logger.error(
          { orderRefHash: hashOrderReference(updatedOrder.ref), err: error },
          'Échec de l’e-mail de mise à jour de la commande',
        );
      }
    }
    res.json({ ref: updatedOrder.ref, status: updatedOrder.status, notificationSent });
  } catch (err) {
    next(err);
  }
});

// Historique des taux
router.get('/rates', async (_req, res, next) => {
  try {
    res.json(await Rate.find().sort({ createdAt: -1, _id: -1 }).limit(20));
  } catch (err) {
    next(err);
  }
});

router.get('/settings', async (_req, res, next) => {
  try {
    const config = await SiteConfig.findOne({ key: 'main' }).lean();
    res.json({
      paymentNumbers: config?.paymentNumbers || { mtn: '', airtel: '' },
      paymentRecipientNames: config?.paymentRecipientNames || { mtn: '', airtel: '' },
      binancePayId: config?.binancePayId || '',
      paymentInstructions: config?.paymentInstructions || '',
      receivingAddresses: config?.receivingAddresses || {},
      contactWhatsApp: config?.contactWhatsApp || '',
      contactEmail: config?.contactEmail || '',
      maintenance: config?.maintenance || {
        enabled: false,
        message: 'Le site est temporairement en maintenance. Revenez bientôt.',
      },
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        networks: configuredNetworks(config, asset),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const input = req.body || {};
    const paymentNumbers = {};
    const paymentRecipientNames = {};
    for (const operator of ['mtn', 'airtel']) {
      const phone = String(input.paymentNumbers?.[operator] || '').replace(/\s/g, '');
      if (phone && !/^\+?\d{8,15}$/.test(phone)) {
        return res.status(400).json({ error: `Numéro ${operator.toUpperCase()} invalide` });
      }
      paymentNumbers[operator] = phone;
      const recipientName = String(input.paymentRecipientNames?.[operator] || '').trim();
      if (recipientName.length > 100) {
        return res
          .status(400)
          .json({ error: `Le nom du bénéficiaire ${operator.toUpperCase()} est trop long` });
      }
      paymentRecipientNames[operator] = recipientName;
    }

    const receivingAddresses = {};
    for (const asset of assets) {
      const networks = input.networks?.[asset.id];
      if (
        !Array.isArray(networks) ||
        networks.length < 3 ||
        networks.length > MAX_NETWORKS_PER_ASSET
      ) {
        return res.status(400).json({
          error: `${asset.id} doit avoir entre 3 et ${MAX_NETWORKS_PER_ASSET} réseaux configurés`,
        });
      }
      receivingAddresses[asset.id] = {};
      const ids = new Set();
      for (const network of networks) {
        if (!network || typeof network !== 'object' || Array.isArray(network)) {
          return res
            .status(400)
            .json({ error: `Configuration de réseau invalide pour ${asset.id}` });
        }
        const id = String(network.id || '').trim();
        const name = String(network.name || '').trim();
        const address = String(network.address || '').trim();
        if (
          !ID_RE.test(id) ||
          ['constructor', 'prototype'].includes(id.toLowerCase()) ||
          ids.has(id)
        ) {
          return res
            .status(400)
            .json({ error: `Identifiant de réseau invalide ou dupliqué pour ${asset.id}` });
        }
        if (!name || name.length > 80)
          return res.status(400).json({ error: 'Nom de réseau invalide' });
        if (address.length > 2000)
          return res.status(400).json({ error: 'Adresse de réception trop longue' });
        ids.add(id);
        receivingAddresses[asset.id][id] = { name, address };
      }
    }

    const rawWhatsApp = String(input.contactWhatsApp || '').trim();
    const contactWhatsApp = rawWhatsApp.startsWith('https://chat.whatsapp.com/')
      ? rawWhatsApp
      : rawWhatsApp.replace(/\s/g, '');
    if (
      contactWhatsApp &&
      !/^(?:\+?\d{8,15}|https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+\/?)$/.test(contactWhatsApp)
    ) {
      return res.status(400).json({ error: 'Lien de groupe ou numéro WhatsApp invalide' });
    }
    const contactEmail = String(input.contactEmail || '').trim();
    if (
      contactEmail.length > 160 ||
      (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))
    ) {
      return res.status(400).json({ error: 'Adresse e-mail invalide' });
    }
    const paymentInstructions = String(input.paymentInstructions || '').trim();
    if (paymentInstructions.length > 500) {
      return res.status(400).json({ error: 'Les instructions de paiement sont trop longues' });
    }
    const binancePayId = String(input.binancePayId || '').trim();
    if (binancePayId && !/^\d{4,32}$/.test(binancePayId)) {
      return res.status(400).json({ error: 'L’ID Binance doit contenir entre 4 et 32 chiffres' });
    }
    const maintenanceMessage = String(input.maintenance?.message || '').trim();
    if (maintenanceMessage.length > 500) {
      return res
        .status(400)
        .json({ error: 'Le message de maintenance est trop long (500 caractères maximum)' });
    }

    const config = await SiteConfig.findOneAndUpdate(
      { key: 'main' },
      {
        $set: {
          paymentNumbers,
          paymentRecipientNames,
          binancePayId,
          paymentInstructions,
          receivingAddresses,
          contactWhatsApp,
          contactEmail,
          maintenance: {
            enabled: Boolean(input.maintenance?.enabled),
            message:
              maintenanceMessage || 'Le site est temporairement en maintenance. Revenez bientôt.',
          },
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ ok: true, updatedAt: config.updatedAt });
  } catch (err) {
    next(err);
  }
});

// Taux commun pour l’USDT et conversion des autres cryptos à partir de leur cours USD.
router.post('/rates', async (req, res, next) => {
  try {
    const { buyRate, sellRate, buyMinXaf, buyMaxXaf, sellMinXaf, sellMaxXaf } = req.body || {};
    const nums = [buyRate, sellRate, buyMinXaf, buyMaxXaf, sellMinXaf, sellMaxXaf].map(Number);
    if (
      nums.some((n) => !Number.isFinite(n) || n <= 0) ||
      nums.slice(0, 2).some((n) => !Number.isSafeInteger(n)) ||
      nums.slice(2).some((n) => !Number.isSafeInteger(n)) ||
      nums[2] >= nums[3] ||
      nums[4] >= nums[5]
    ) {
      return res
        .status(400)
        .json({ error: 'Le taux commun et les limites achat/vente sont invalides' });
    }
    const rate = await Rate.create({
      asset: 'USDT',
      buyRate: nums[0],
      sellRate: nums[1],
      minXaf: Math.min(nums[2], nums[4]),
      maxXaf: Math.max(nums[3], nums[5]),
      buyMinXaf: nums[2],
      buyMaxXaf: nums[3],
      sellMinXaf: nums[4],
      sellMaxXaf: nums[5],
    });
    res.status(201).json(rate);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
