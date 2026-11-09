'use strict';

const TRANSACTION_TOPOLOGIES = new Set([
  'ReplicaSetWithPrimary',
  'Sharded',
  'LoadBalanced',
]);

function supportsMultiDocumentTransactions(connection) {
  try {
    const topology = connection.getClient().topology?.description?.type;
    return TRANSACTION_TOPOLOGIES.has(topology);
  } catch {
    return false;
  }
}

module.exports = { supportsMultiDocumentTransactions };
