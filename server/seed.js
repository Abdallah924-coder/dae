require('dotenv').config();
const mongoose = require('mongoose');
const Rate = require('./models/Rate');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Rate.create({ asset: 'USDT', buyRate: 640, sellRate: 640, minXaf: 10000, maxXaf: 500000 });
  console.log('Taux initial créé');
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
