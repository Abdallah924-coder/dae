const mongoose = require('mongoose');

const siteConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true },
    paymentNumbers: {
      mtn: { type: String, default: '' },
      airtel: { type: String, default: '' },
    },
    paymentRecipientNames: {
      mtn: { type: String, default: '' },
      airtel: { type: String, default: '' },
    },
    paymentInstructions: { type: String, default: '' },
    receivingAddresses: { type: mongoose.Schema.Types.Mixed, default: {} },
    contactWhatsApp: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    maintenance: {
      enabled: { type: Boolean, default: false },
      message: { type: String, default: 'Le site est temporairement en maintenance. Revenez bientôt.' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteConfig', siteConfigSchema);
