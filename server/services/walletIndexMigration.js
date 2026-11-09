'use strict';

const Wallet = require('../models/Wallet');
const { logger } = require('../lib/logger');

const addressIndexName = 'wallet_address_per_network_unique';
const addressIndexKeys = { network: 1, address: 1 };

async function migrateWalletAddressIndex() {
  let indexes = [];
  try {
    indexes = await Wallet.collection.indexes();
  } catch (error) {
    if (error.codeName !== 'NamespaceNotFound' && error.code !== 26) throw error;
  }
  const legacySparseIndex = indexes.find(
    (index) =>
      index.sparse &&
      index.unique &&
      Object.keys(index.key).length === 2 &&
      index.key.network === 1 &&
      index.key.address === 1,
  );
  if (legacySparseIndex) await Wallet.collection.dropIndex(legacySparseIndex.name);
  await Wallet.collection.createIndex(addressIndexKeys, {
    unique: true,
    partialFilterExpression: { address: { $type: 'string' } },
    name: addressIndexName,
  });
  if (legacySparseIndex) {
    logger.info('Ancien index sparse des adresses wallet remplacé par un index partiel.');
  }
  return Boolean(legacySparseIndex);
}

module.exports = { migrateWalletAddressIndex };
