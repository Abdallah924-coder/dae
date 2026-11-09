'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getDepositLogs,
  isTransientRpcError,
  withTransientRpcRetry,
} = require('./indexBscDeposits');

function limitError() {
  const error = new Error('RPC limit exceeded');
  error.info = { error: { code: -32005 } };
  return error;
}

test('getDepositLogs splits an oversized block range without gaps or duplicates', async () => {
  const provider = {
    async getLogs(filter) {
      if (filter.toBlock - filter.fromBlock > 1) throw limitError();
      return Array.from({ length: filter.toBlock - filter.fromBlock + 1 }, (_value, index) => ({
        blockNumber: filter.fromBlock + index,
      }));
    },
  };

  const logs = await getDepositLogs(provider, {
    address: '0x0000000000000000000000000000000000000001',
    fromBlock: 10,
    toBlock: 17,
    topics: ['0xtransfer', null, ['0xrecipient']],
  });

  assert.deepEqual(
    logs.map((log) => log.blockNumber),
    [10, 11, 12, 13, 14, 15, 16, 17],
  );
});

test('getDepositLogs splits recipient filters when one block exceeds the RPC limit', async () => {
  const recipients = ['0xa', '0xb', '0xc', '0xd'];
  const provider = {
    async getLogs(filter) {
      const topics = filter.topics[2];
      if (topics.length > 1) throw limitError();
      return [{ recipient: topics[0] }];
    },
  };

  const logs = await getDepositLogs(provider, {
    address: '0x0000000000000000000000000000000000000001',
    fromBlock: 10,
    toBlock: 10,
    topics: ['0xtransfer', null, recipients],
  });

  assert.deepEqual(
    logs.map((log) => log.recipient),
    recipients,
  );
});

test('getDepositLogs surfaces RPC errors unrelated to response limits', async () => {
  const failure = new Error('RPC unavailable');
  const provider = {
    getLogs: async () => {
      throw failure;
    },
  };

  await assert.rejects(
    getDepositLogs(provider, {
      address: '0x0000000000000000000000000000000000000001',
      fromBlock: 10,
      toBlock: 10,
      topics: ['0xtransfer', null, ['0xrecipient']],
    }),
    (error) => error === failure,
  );
});

test('withTransientRpcRetry retries nested network timeouts', async () => {
  const timeout = Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' });
  const failure = new AggregateError([timeout]);
  let attempts = 0;

  assert.equal(isTransientRpcError(failure), true);
  const result = await withTransientRpcRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw failure;
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});
