'use strict';

const { parseUnits } = require('ethers');

const TRANSFER_FEE_BPS = 5n;
const FEE_DENOMINATOR = 10_000n;
const MINIMUM_TRANSFER_ATOMIC = parseUnits('1', 18);

function calculateTransferAmounts(amountText) {
  const normalized = String(amountText || '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(normalized)) {
    throw new TypeError('Montant invalide : maximum 18 décimales.');
  }
  const amountAtomic = parseUnits(normalized, 18);
  if (amountAtomic < MINIMUM_TRANSFER_ATOMIC) {
    throw new RangeError('Le montant minimum d’envoi est de 1 USDT.');
  }
  const feeAtomic = (amountAtomic * TRANSFER_FEE_BPS + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;
  const recipientAmountAtomic = amountAtomic - feeAtomic;
  if (recipientAmountAtomic <= 0n) {
    throw new RangeError('Le montant net après frais doit être supérieur à zéro.');
  }
  return {
    amountAtomic: amountAtomic.toString(),
    feeAtomic: feeAtomic.toString(),
    recipientAmountAtomic: recipientAmountAtomic.toString(),
  };
}

function buildTransferPostings({ senderId, recipientId, feeRecipientId, amountAtomic, feeAtomic, recipientAmountAtomic }) {
  return [
    { accountRef: `customer:${senderId}:available`, asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic },
    { accountRef: `customer:${recipientId}:available`, asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: recipientAmountAtomic },
    { accountRef: `customer:${feeRecipientId}:available`, asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: feeAtomic },
  ];
}

module.exports = { buildTransferPostings, calculateTransferAmounts };
