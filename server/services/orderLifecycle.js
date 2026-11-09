'use strict';

const mongoose = require('mongoose');
const Order = require('../models/Order');
const OrderEvent = require('../models/OrderEvent');
const { supportsMultiDocumentTransactions } = require('./mongoCapabilities');

function requireTransactions() {
  if (supportsMultiDocumentTransactions(mongoose.connection)) return;
  const error = new Error('La gestion des commandes exige des transactions MongoDB multi-documents.');
  error.code = 'ERR_ORDER_TRANSACTIONS_REQUIRED';
  error.status = 503;
  throw error;
}

async function createOrderWithEvent(orderData, eventData) {
  requireTransactions();
  const session = await mongoose.startSession();
  let createdOrder;
  try {
    await session.withTransaction(async () => {
      createdOrder = null;
      const [order] = await Order.create([orderData], { session });
      await OrderEvent.create([{ ...eventData, orderRef: order.ref }], { session });
      createdOrder = order;
    });
    return { order: createdOrder, duplicate: false };
  } catch (error) {
    if (error.code !== 11000 || !orderData.idempotencyKey) throw error;
    const existingOrder = await Order.findOne({
      customerId: orderData.customerId,
      idempotencyKey: orderData.idempotencyKey,
    });
    if (!existingOrder) throw error;
    if (existingOrder.idempotencyHash !== orderData.idempotencyHash) {
      const conflict = new Error('Cette clé de commande a déjà été utilisée avec d’autres données.');
      conflict.code = 'ERR_ORDER_IDEMPOTENCY_CONFLICT';
      conflict.status = 409;
      conflict.orderRef = existingOrder.ref;
      throw conflict;
    }
    return { order: existingOrder, duplicate: true };
  } finally {
    await session.endSession();
  }
}

async function transitionOrder({
  orderId,
  expectedStatus,
  nextStatus,
  actorType,
  actorRef,
  note,
  changes = {},
  expiresAfter,
  validAfter,
}) {
  requireTransactions();
  const session = await mongoose.startSession();
  let updatedOrder;
  try {
    await session.withTransaction(async () => {
      updatedOrder = null;
      const filter = { _id: orderId, status: expectedStatus };
      if (expiresAfter) filter.expiresAt = { $lte: expiresAfter };
      if (validAfter) filter.expiresAt = { $gt: validAfter };
      const order = await Order.findOneAndUpdate(
        filter,
        { $set: { ...changes, status: nextStatus } },
        { new: true, runValidators: true, session },
      );
      if (!order) return;
      await OrderEvent.create(
        [
          {
            orderRef: order.ref,
            from: expectedStatus,
            to: nextStatus,
            actorType,
            ...(actorRef ? { actorRef } : {}),
            ...(note ? { note } : {}),
          },
        ],
        { session },
      );
      updatedOrder = order;
    });
    return updatedOrder;
  } finally {
    await session.endSession();
  }
}

module.exports = { createOrderWithEvent, transitionOrder };
