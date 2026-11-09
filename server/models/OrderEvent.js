const mongoose = require('mongoose');
const ORDER_STATUSES = require('../config/orderStatuses');

// Journal : une ligne par changement de statut.
const eventSchema = new mongoose.Schema(
  {
    orderRef: { type: String, required: true, maxlength: 40 },
    from: { type: String, enum: ORDER_STATUSES },
    to: { type: String, enum: ORDER_STATUSES, required: true },
    actorType: { type: String, enum: ['customer', 'guest', 'admin', 'system'], required: true },
    actorRef: { type: String, maxlength: 120 },
    note: { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

eventSchema.index({ orderRef: 1, createdAt: 1 });
eventSchema.pre('save', function preventEventMutation() {
  if (!this.isNew) throw new Error('Order events are append-only');
});

for (const operation of [
  'update',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
]) {
  eventSchema.pre(operation, function preventEventMutation() {
    throw new Error('Order events are append-only');
  });
}

eventSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function preventDocumentEventDeletion() {
    throw new Error('Order events are append-only');
  },
);

module.exports = mongoose.model('OrderEvent', eventSchema);
