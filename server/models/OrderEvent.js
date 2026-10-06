const mongoose = require('mongoose');

// Journal : une ligne par changement de statut.
const eventSchema = new mongoose.Schema(
  {
    orderRef: { type: String, required: true, index: true },
    from: { type: String },
    to: { type: String, required: true },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('OrderEvent', eventSchema);
