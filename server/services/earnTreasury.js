'use strict';

const { Contract, Interface, getAddress } = require('ethers');
const { config } = require('../config');
const { EARN_PROTOCOLS } = require('../config/earnProtocols');

const USDT_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const VENUS_WITHDRAWAL_INTERFACE = new Interface([
  'function redeem(uint256 redeemTokens)',
  'function redeemUnderlying(uint256 redeemAmount)',
]);
const AAVE_WITHDRAWAL_INTERFACE = new Interface([
  'function withdraw(address asset,uint256 amount,address to) returns (uint256)',
]);
const VENUS_DEPOSIT_INTERFACE = new Interface(['function mint(uint256 mintAmount) returns (uint256)']);
const AAVE_DEPOSIT_INTERFACE = new Interface([
  'function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)',
]);
const ERC20_TRANSFER_INTERFACE = new Interface([
  'function transfer(address to,uint256 amount) returns (bool)',
]);
const VENUS_MARKET_EVENTS = new Interface([
  'event Mint(address minter,uint256 mintAmount,uint256 mintTokens,uint256 totalSupply)',
  'event Redeem(address redeemer,uint256 redeemAmount,uint256 redeemTokens,uint256 totalSupply)',
  'event Mint(address minter,uint256 mintAmount,uint256 mintTokens)',
  'event Redeem(address redeemer,uint256 redeemAmount,uint256 redeemTokens)',
]);
const AAVE_POOL_EVENTS = new Interface([
  'event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 referralCode)',
  'event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
]);

function configuredEarnTreasuryAddress() {
  const value = String(process.env.DAE_EARN_TREASURY_ADDRESS || '').trim();
  return value ? getAddress(value) : null;
}

async function assertUsdtContract(provider, expectedAddress) {
  const tokenAddress = getAddress(config.bsc.usdtContract);
  if (tokenAddress !== getAddress(expectedAddress)) {
    const error = new Error('Le contrat USDT configuré ne correspond pas au marché Earn vérifié.');
    error.code = 'ERR_EARN_UNDERLYING_MISMATCH';
    throw error;
  }
  if (await provider.getCode(tokenAddress) === '0x') {
    const error = new Error('Le contrat USDT Earn est absent de la chaîne configurée.');
    error.code = 'ERR_EARN_TOKEN_INVALID';
    throw error;
  }
  const token = new Contract(tokenAddress, ['function decimals() view returns (uint8)'], provider);
  if (Number(await token.decimals()) !== 18) {
    const error = new Error('La précision du contrat USDT Earn est inattendue.');
    error.code = 'ERR_EARN_TOKEN_INVALID';
    throw error;
  }
  return tokenAddress;
}

function topicAddress(topic) {
  if (!/^0x[0-9a-f]{64}$/i.test(topic || '')) return null;
  return getAddress(`0x${topic.slice(-40)}`);
}

function decodeWithdrawal(protocol, transaction) {
  try {
    if (protocol === 'venus') {
      if (getAddress(transaction.from) !== configuredEarnTreasuryAddress()) return false;
      const parsed = VENUS_WITHDRAWAL_INTERFACE.parseTransaction({ data: transaction.data });
      return parsed?.name === 'redeem' || parsed?.name === 'redeemUnderlying';
    }
    if (protocol === 'aaveV3') {
      if (getAddress(transaction.from) !== configuredEarnTreasuryAddress()) return false;
      const parsed = AAVE_WITHDRAWAL_INTERFACE.parseTransaction({ data: transaction.data });
      return parsed?.name === 'withdraw'
        && getAddress(parsed.args.asset) === getAddress(EARN_PROTOCOLS.aaveV3.underlying)
        && getAddress(parsed.args.to) === configuredEarnTreasuryAddress();
    }
  } catch {
    return false;
  }
  return false;
}

async function verifyProtocolRedemptionReceipt({ provider, txHash, protocol }) {
  const treasuryAddress = configuredEarnTreasuryAddress();
  if (!treasuryAddress) {
    const error = new Error('DAE_EARN_TREASURY_ADDRESS doit être configurée pour réconcilier un rendement.');
    error.code = 'ERR_EARN_TREASURY_NOT_CONFIGURED';
    throw error;
  }
  const protocolConfig = EARN_PROTOCOLS[protocol];
  if (!protocolConfig) throw new TypeError('Protocole DAE Earn invalide.');
  const tokenAddress = await assertUsdtContract(provider, protocolConfig.underlying);
  if (!/^0x[0-9a-f]{64}$/i.test(String(txHash || ''))) {
    throw new TypeError('Hash de transaction BSC invalide.');
  }
  const chain = await provider.getNetwork();
  if (Number(chain.chainId) !== 56 || config.bsc.chainId !== 56) {
    const error = new Error('La réconciliation Earn est limitée à BNB Smart Chain.');
    error.code = 'ERR_EARN_WRONG_CHAIN';
    throw error;
  }
  const [transaction, receipt, currentBlock] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
    provider.getBlockNumber(),
  ]);
  if (!transaction || !receipt) {
    const error = new Error('Transaction de rendement introuvable sur BNB Smart Chain.');
    error.code = 'ERR_EARN_RECEIPT_NOT_FOUND';
    throw error;
  }
  if (String(receipt.hash).toLowerCase() !== String(txHash).toLowerCase()) {
    const error = new Error('Le RPC a retourné un reçu différent du hash demandé.');
    error.code = 'ERR_EARN_RECEIPT_HASH_MISMATCH';
    throw error;
  }
  if (receipt.status !== 1) {
    const error = new Error('La transaction de rendement a échoué.');
    error.code = 'ERR_EARN_RECEIPT_FAILED';
    throw error;
  }
  const requiredConfirmations = Math.max(1, config.bsc.confirmations);
  if (currentBlock - receipt.blockNumber + 1 < requiredConfirmations) {
    const error = new Error('La transaction de rendement n’a pas encore assez de confirmations.');
    error.code = 'ERR_EARN_RECEIPT_UNCONFIRMED';
    throw error;
  }
  const expectedTarget = protocol === 'venus' ? protocolConfig.market : protocolConfig.pool;
  if (getAddress(transaction.to || '') !== getAddress(expectedTarget) || !decodeWithdrawal(protocol, transaction)) {
    const error = new Error('La transaction ne correspond pas à un retrait du protocole vers la trésorerie Earn DAE.');
    error.code = 'ERR_EARN_RECEIPT_CALL_MISMATCH';
    throw error;
  }
  const protocolSource = getAddress(protocol === 'venus' ? protocolConfig.market : protocolConfig.aToken);
  let amountAtomic = 0n;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== tokenAddress || log.topics?.[0]?.toLowerCase() !== USDT_TRANSFER_TOPIC) continue;
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    if (from !== protocolSource || to !== treasuryAddress) continue;
    amountAtomic += BigInt(log.data);
  }
  if (amountAtomic <= 0n) {
    const error = new Error('Aucun transfert USDT confirmé du protocole vers la trésorerie Earn.');
    error.code = 'ERR_EARN_RECEIPT_NO_USDT';
    throw error;
  }
  const redeemed = protocol === 'venus'
    ? sumProtocolEvents(receipt, {
      contractAddress: protocolConfig.market,
      eventInterface: VENUS_MARKET_EVENTS,
      eventName: 'Redeem',
      subject: treasuryAddress,
    })
    : sumProtocolEvents(receipt, {
      contractAddress: protocolConfig.pool,
      eventInterface: AAVE_POOL_EVENTS,
      eventName: 'Withdraw',
      asset: tokenAddress,
      subject: treasuryAddress,
      beneficiary: treasuryAddress,
    });
  if (redeemed !== amountAtomic) {
    const error = new Error('Le reçu ne contient pas l’événement de retrait USDT attendu du protocole.');
    error.code = 'ERR_EARN_REDEMPTION_EVENT_MISMATCH';
    throw error;
  }
  return {
    txHash: receipt.hash,
    protocol,
    chainId: 56,
    blockNumber: receipt.blockNumber,
    treasuryAddress,
    grossAmountAtomic: amountAtomic.toString(),
  };
}

async function confirmedReceipt(provider, txHash) {
  if (!/^0x[0-9a-f]{64}$/i.test(String(txHash || ''))) {
    throw new TypeError('Hash de transaction BSC invalide.');
  }
  const chain = await provider.getNetwork();
  if (Number(chain.chainId) !== 56 || config.bsc.chainId !== 56) {
    const error = new Error('La réconciliation Earn est limitée à BNB Smart Chain.');
    error.code = 'ERR_EARN_WRONG_CHAIN';
    throw error;
  }
  const [transaction, receipt, currentBlock] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
    provider.getBlockNumber(),
  ]);
  if (!transaction || !receipt) {
    const error = new Error('Transaction introuvable sur BNB Smart Chain.');
    error.code = 'ERR_EARN_RECEIPT_NOT_FOUND';
    throw error;
  }
  if (String(receipt.hash).toLowerCase() !== String(txHash).toLowerCase()) {
    const error = new Error('Le RPC a retourné un reçu différent du hash demandé.');
    error.code = 'ERR_EARN_RECEIPT_HASH_MISMATCH';
    throw error;
  }
  if (receipt.status !== 1) {
    const error = new Error('La transaction BSC a échoué.');
    error.code = 'ERR_EARN_RECEIPT_FAILED';
    throw error;
  }
  if (currentBlock - receipt.blockNumber + 1 < Math.max(1, config.bsc.confirmations)) {
    const error = new Error('La transaction BSC n’a pas encore assez de confirmations.');
    error.code = 'ERR_EARN_RECEIPT_UNCONFIRMED';
    throw error;
  }
  return { transaction, receipt };
}

function sumTransfers(receipt, { tokenAddress, from, to, excludeFrom }) {
  let amountAtomic = 0n;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(tokenAddress) || log.topics?.[0]?.toLowerCase() !== USDT_TRANSFER_TOPIC) continue;
    const sender = topicAddress(log.topics[1]);
    const recipient = topicAddress(log.topics[2]);
    if (excludeFrom && sender === getAddress(excludeFrom)) continue;
    if ((!from || sender === getAddress(from)) && (!to || recipient === getAddress(to))) {
      amountAtomic += BigInt(log.data);
    }
  }
  return amountAtomic;
}

function sumProtocolEvents(receipt, { contractAddress, eventInterface, eventName, subject, asset, beneficiary }) {
  let amountAtomic = 0n;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(contractAddress)) continue;
    let parsed;
    try {
      parsed = eventInterface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== eventName) continue;
    const args = parsed.args;
    if (subject && getAddress(args.minter || args.redeemer || args.user) !== getAddress(subject)) continue;
    if (asset && getAddress(args.reserve) !== getAddress(asset)) continue;
    if (beneficiary && getAddress(args.onBehalfOf || args.to) !== getAddress(beneficiary)) continue;
    amountAtomic += BigInt(args.mintAmount ?? args.redeemAmount ?? args.amount);
  }
  return amountAtomic;
}

async function verifyProtocolAllocationReceipt({ provider, txHash, protocol, expectedAmountAtomic }) {
  const treasuryAddress = configuredEarnTreasuryAddress();
  if (!treasuryAddress) {
    const error = new Error('DAE_EARN_TREASURY_ADDRESS doit être configurée.');
    error.code = 'ERR_EARN_TREASURY_NOT_CONFIGURED';
    throw error;
  }
  const protocolConfig = EARN_PROTOCOLS[protocol];
  if (!protocolConfig) throw new TypeError('Protocole DAE Earn invalide.');
  const tokenAddress = await assertUsdtContract(provider, protocolConfig.underlying);
  const { transaction, receipt } = await confirmedReceipt(provider, txHash);
  if (getAddress(transaction.from) !== treasuryAddress) {
    const error = new Error('La transaction d’allocation doit provenir de la trésorerie DAE Earn.');
    error.code = 'ERR_EARN_ALLOCATION_CALL_MISMATCH';
    throw error;
  }
  const target = protocol === 'venus' ? protocolConfig.market : protocolConfig.pool;
  if (getAddress(transaction.to || '') !== getAddress(target)) {
    const error = new Error('La transaction ne cible pas le marché protocolaire configuré.');
    error.code = 'ERR_EARN_ALLOCATION_CALL_MISMATCH';
    throw error;
  }
  let amount;
  try {
    if (protocol === 'venus') {
      const parsed = VENUS_DEPOSIT_INTERFACE.parseTransaction({ data: transaction.data });
      if (parsed?.name !== 'mint') throw new Error();
      amount = BigInt(parsed.args.mintAmount);
    } else {
      const parsed = AAVE_DEPOSIT_INTERFACE.parseTransaction({ data: transaction.data });
      if (
        parsed?.name !== 'supply' ||
        getAddress(parsed.args.asset) !== getAddress(protocolConfig.underlying) ||
        getAddress(parsed.args.onBehalfOf) !== treasuryAddress
      ) throw new Error();
      amount = BigInt(parsed.args.amount);
    }
  } catch {
    const error = new Error('L’appel BSC ne correspond pas à un dépôt USDT pris en charge.');
    error.code = 'ERR_EARN_ALLOCATION_CALL_MISMATCH';
    throw error;
  }
  if (amount.toString() !== String(expectedAmountAtomic)) {
    const error = new Error('Le montant on-chain ne correspond pas au montant du placement.');
    error.code = 'ERR_EARN_ALLOCATION_AMOUNT_MISMATCH';
    throw error;
  }
  const recipient = protocol === 'venus' ? protocolConfig.market : protocolConfig.aToken;
  const received = sumTransfers(receipt, {
    tokenAddress,
    from: treasuryAddress,
    to: recipient,
  });
  if (received !== amount) {
    const error = new Error('Le reçu ne prouve pas le transfert USDT intégral vers le marché.');
    error.code = 'ERR_EARN_ALLOCATION_TRANSFER_MISMATCH';
    throw error;
  }
  const supplied = protocol === 'venus'
    ? sumProtocolEvents(receipt, {
      contractAddress: protocolConfig.market,
      eventInterface: VENUS_MARKET_EVENTS,
      eventName: 'Mint',
      subject: treasuryAddress,
    })
    : sumProtocolEvents(receipt, {
      contractAddress: protocolConfig.pool,
      eventInterface: AAVE_POOL_EVENTS,
      eventName: 'Supply',
      subject: treasuryAddress,
      asset: tokenAddress,
      beneficiary: treasuryAddress,
    });
  if (supplied !== amount) {
    const error = new Error('Le reçu ne contient pas l’événement de dépôt USDT attendu du protocole.');
    error.code = 'ERR_EARN_ALLOCATION_EVENT_MISMATCH';
    throw error;
  }
  return {
    txHash: receipt.hash,
    protocol,
    chainId: 56,
    blockNumber: receipt.blockNumber,
    treasuryAddress,
    amountAtomic: amount.toString(),
  };
}

async function verifyTreasuryFundingReceipt({ provider, txHash }) {
  const treasuryAddress = configuredEarnTreasuryAddress();
  if (!treasuryAddress) {
    const error = new Error('DAE_EARN_TREASURY_ADDRESS doit être configurée.');
    error.code = 'ERR_EARN_TREASURY_NOT_CONFIGURED';
    throw error;
  }
  const tokenAddress = await assertUsdtContract(provider, EARN_PROTOCOLS.venus.underlying);
  const { receipt } = await confirmedReceipt(provider, txHash);
  const amount = sumTransfers(receipt, {
    tokenAddress,
    to: treasuryAddress,
    excludeFrom: treasuryAddress,
  });
  if (amount <= 0n) {
    const error = new Error('Le reçu ne contient aucun transfert USDT entrant vers la trésorerie Earn.');
    error.code = 'ERR_EARN_TREASURY_FUNDING_NOT_FOUND';
    throw error;
  }
  return {
    txHash: receipt.hash,
    chainId: 56,
    blockNumber: receipt.blockNumber,
    treasuryAddress,
    amountAtomic: amount.toString(),
  };
}

async function verifyTreasuryPayoutReceipt({ provider, txHash, expectedAmountAtomic }) {
  const treasuryAddress = configuredEarnTreasuryAddress();
  if (!treasuryAddress) {
    const error = new Error('DAE_EARN_TREASURY_ADDRESS doit être configurée.');
    error.code = 'ERR_EARN_TREASURY_NOT_CONFIGURED';
    throw error;
  }
  if (!config.bsc.masterAddress || !/^0x[0-9a-f]{40}$/i.test(config.bsc.masterAddress)) {
    const error = new Error('BSC_MASTER_ADDRESS doit être configurée pour restituer les fonds au wallet opérationnel.');
    error.code = 'ERR_EARN_SETTLEMENT_ADDRESS_NOT_CONFIGURED';
    throw error;
  }
  const settlementAddress = getAddress(config.bsc.masterAddress);
  if (settlementAddress === treasuryAddress) {
    const error = new Error('La trésorerie DeFi et le wallet opérationnel doivent être distincts.');
    error.code = 'ERR_EARN_TREASURY_ADDRESSES_NOT_SEPARATE';
    throw error;
  }
  const tokenAddress = await assertUsdtContract(provider, EARN_PROTOCOLS.venus.underlying);
  const { transaction, receipt } = await confirmedReceipt(provider, txHash);
  if (getAddress(transaction.from) !== treasuryAddress || getAddress(transaction.to || '') !== tokenAddress) {
    const error = new Error('Le remboursement doit être un transfert USDT de la trésorerie DeFi au wallet opérationnel.');
    error.code = 'ERR_EARN_PAYOUT_CALL_MISMATCH';
    throw error;
  }
  let call;
  try {
    call = ERC20_TRANSFER_INTERFACE.parseTransaction({ data: transaction.data });
  } catch {
    call = null;
  }
  const amountAtomic = String(expectedAmountAtomic || '');
  if (
    call?.name !== 'transfer' ||
    getAddress(call.args.to) !== settlementAddress ||
    BigInt(call.args.amount).toString() !== amountAtomic ||
    BigInt(transaction.value || 0) !== 0n
  ) {
    const error = new Error('Le transfert USDT ne correspond pas au principal attendu et au wallet opérationnel.');
    error.code = 'ERR_EARN_PAYOUT_AMOUNT_MISMATCH';
    throw error;
  }
  const received = sumTransfers(receipt, {
    tokenAddress,
    from: treasuryAddress,
    to: settlementAddress,
  });
  if (received !== BigInt(amountAtomic)) {
    const error = new Error('Le reçu ne prouve pas le transfert intégral du principal au wallet opérationnel.');
    error.code = 'ERR_EARN_PAYOUT_TRANSFER_MISMATCH';
    throw error;
  }
  return {
    txHash: receipt.hash,
    chainId: 56,
    blockNumber: receipt.blockNumber,
    treasuryAddress,
    settlementAddress,
    amountAtomic: received.toString(),
  };
}

async function getTreasuryUsdtSnapshot(provider) {
  const treasuryAddress = configuredEarnTreasuryAddress();
  if (!treasuryAddress) {
    const error = new Error('DAE_EARN_TREASURY_ADDRESS doit être configurée.');
    error.code = 'ERR_EARN_TREASURY_NOT_CONFIGURED';
    throw error;
  }
  const chain = await provider.getNetwork();
  if (Number(chain.chainId) !== 56 || config.bsc.chainId !== 56) {
    const error = new Error('La trésorerie DAE Earn doit être sur BNB Smart Chain.');
    error.code = 'ERR_EARN_WRONG_CHAIN';
    throw error;
  }
  const tokenAddress = await assertUsdtContract(provider, EARN_PROTOCOLS.venus.underlying);
  const token = new Contract(
    tokenAddress,
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  const [blockNumber, tokenCode, decimals, balanceAtomic] = await Promise.all([
    provider.getBlockNumber(),
    provider.getCode(tokenAddress),
    token.decimals(),
    token.balanceOf(treasuryAddress),
  ]);
  if (tokenCode === '0x' || Number(decimals) !== 18) {
    const error = new Error('Le contrat USDT de trésorerie est absent ou sa précision est inattendue.');
    error.code = 'ERR_EARN_TOKEN_INVALID';
    throw error;
  }
  return {
    treasuryAddress,
    chainId: 56,
    blockNumber,
    balanceAtomic: balanceAtomic.toString(),
  };
}

module.exports = {
  configuredEarnTreasuryAddress,
  getTreasuryUsdtSnapshot,
  verifyProtocolAllocationReceipt,
  verifyProtocolRedemptionReceipt,
  verifyTreasuryFundingReceipt,
  verifyTreasuryPayoutReceipt,
};
