const mongoose = require('mongoose');

const safeXafAmount = {
  validator: Number.isSafeInteger,
  message: 'La limite doit être un entier FCFA sûr',
};

// Chaque changement de taux crée un nouveau document : le plus récent est le taux actif.
// buyRate  = FCFA par USDT quand le client ACHETE de l'USDT
// sellRate = FCFA par USDT quand le client VEND de l'USDT
const rateSchema = new mongoose.Schema(
  {
    asset: {
      type: String,
      enum: ['USDT', 'BTC', 'POL', 'ETH', 'SOL'],
      default: 'USDT',
      index: true,
    },
    buyRate: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isSafeInteger, message: 'Le taux doit être un entier FCFA sûr' },
    },
    sellRate: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isSafeInteger, message: 'Le taux doit être un entier FCFA sûr' },
    },
    minXaf: { type: Number, required: true, min: 0, validate: safeXafAmount },
    maxXaf: { type: Number, required: true, min: 0, validate: safeXafAmount },
    buyMinXaf: { type: Number, min: 0, validate: safeXafAmount },
    buyMaxXaf: { type: Number, min: 0, validate: safeXafAmount },
    sellMinXaf: { type: Number, min: 0, validate: safeXafAmount },
    sellMaxXaf: { type: Number, min: 0, validate: safeXafAmount },
  },
  { timestamps: true },
);

rateSchema.pre('validate', function validateLimitPairs() {
  if (this.minXaf > this.maxXaf) {
    this.invalidate('maxXaf', 'La limite générale maximale doit dépasser la limite minimale');
  }
  for (const [minimum, maximum] of [
    ['buyMinXaf', 'buyMaxXaf'],
    ['sellMinXaf', 'sellMaxXaf'],
  ]) {
    if (this[minimum] != null && this[maximum] != null && this[minimum] >= this[maximum]) {
      this.invalidate(maximum, `${maximum} doit être supérieur à ${minimum}`);
    }
  }
});

module.exports = mongoose.model('Rate', rateSchema);
