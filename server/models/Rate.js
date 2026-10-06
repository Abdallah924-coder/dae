const mongoose = require('mongoose');

// Chaque changement de taux crée un nouveau document : le plus récent est le taux actif.
// buyRate  = FCFA par USDT quand le client ACHETE de l'USDT
// sellRate = FCFA par USDT quand le client VEND de l'USDT
const rateSchema = new mongoose.Schema(
  {
    asset: { type: String, enum: ['USDT', 'BTC', 'POL', 'ETH', 'SOL'], default: 'USDT', index: true },
    buyRate: { type: Number, required: true, min: 1 },
    sellRate: { type: Number, required: true, min: 1 },
    minXaf: { type: Number, required: true, min: 0 },
    maxXaf: { type: Number, required: true, min: 0 },
    buyMinXaf: { type: Number, min: 0 },
    buyMaxXaf: { type: Number, min: 0 },
    sellMinXaf: { type: Number, min: 0 },
    sellMaxXaf: { type: Number, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Rate', rateSchema);
