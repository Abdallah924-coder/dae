const mongoose = require('mongoose');

module.exports = async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI manquant dans .env');
  await mongoose.connect(uri);
  console.log('MongoDB connecté');
};
