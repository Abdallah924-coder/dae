'use strict';

const { HDNodeWallet, JsonRpcProvider, getAddress, id, Interface, isAddress } = require('ethers');
const { config, BSC_PEG_USD_CONTRACT } = require('../config');

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)');
const transferInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
let provider;

function bscConfigStatus() {
  const { bsc } = config;
  let usableXpub = false;
  try { usableXpub = Boolean(bsc.hdPublicKey && /^xpub/.test(bsc.hdPublicKey) && HDNodeWallet.fromExtendedKey(bsc.hdPublicKey).depth === 4); } catch { usableXpub = false; }
  const statuses = {
    rpc: Boolean(bsc.rpcUrl),
    xpub: usableXpub,
    chainId: bsc.chainId === 56,
    token: Boolean(bsc.usdtContract && isAddress(bsc.usdtContract) && bsc.usdtContract.toLowerCase() === BSC_PEG_USD_CONTRACT),
    startBlock: Number.isSafeInteger(bsc.startBlock) && bsc.startBlock > 0,
    depositsEnabled: bsc.depositsEnabled,
    master: Boolean(bsc.masterAddress && isAddress(bsc.masterAddress)),
    gas: Boolean(bsc.gasAddress && isAddress(bsc.gasAddress)),
    sweepsEnabled: bsc.sweepsEnabled,
    withdrawalsEnabled: bsc.withdrawalsEnabled,
  };
  return { ...statuses, ready: Object.values(statuses).every(Boolean) };
}

function deriveCustomerAddress(index) {
  const xpub = config.bsc.hdPublicKey;
  if (!bscConfigStatus().xpub) return null;
  if (!Number.isSafeInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new RangeError('Indice HD BSC invalide');
  }
  // BSC uses the EVM coin type. Configure this public key at m/44'/60'/0'/0;
  // the customer index is the non-hardened child, so the web app never needs a seed.
  return getAddress(HDNodeWallet.fromExtendedKey(xpub).deriveChild(index).address);
}

function getProvider() {
  if (!config.bsc.rpcUrl) throw new Error('BSC_RPC_URL non configuré');
  if (!provider) provider = new JsonRpcProvider(config.bsc.rpcUrl, config.bsc.chainId, { staticNetwork: true });
  return provider;
}

function parseTransferLog(log) {
  const parsed = transferInterface.parseLog(log);
  return {
    from: getAddress(parsed.args.from),
    to: getAddress(parsed.args.to),
    amountAtomic: parsed.args.value.toString(),
    eventIndex: Number(log.index ?? log.logIndex),
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

module.exports = { bscConfigStatus, deriveCustomerAddress, getProvider, parseTransferLog, TRANSFER_TOPIC };
