'use strict';

const mongoose = require('mongoose');
const { config } = require('./index');

module.exports = async function connectDB() {
  await mongoose.connect(config.database.uri);
  console.log('MongoDB connecté');
};