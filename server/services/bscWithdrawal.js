'use strict';

const { postLedgerTransaction } = require('./ledger');

async function reserveBscWithdrawal(withdrawal) {
  return postLedgerTransaction({
    type: 'withdrawal',
    idempotencyKey: `bsc-withdrawal-reserve:${withdrawal.idempotencyKey}`,
    sourceRef: String(withdrawal._id),
    createdBy: `customer:${withdrawal.customerId}`,
    postings: [
      {
        accountRef: `customer:${withdrawal.customerId}:available`,
        asset: 'USDT', network: 'BEP20', decimals: 18,
        side: 'debit', amountAtomic: withdrawal.amountAtomic,
      },
      {
        accountRef: `customer:${withdrawal.customerId}:reserved`,
        asset: 'USDT', network: 'BEP20', decimals: 18,
        side: 'credit', amountAtomic: withdrawal.amountAtomic,
      },
    ],
  });
}

module.exports = { reserveBscWithdrawal };
