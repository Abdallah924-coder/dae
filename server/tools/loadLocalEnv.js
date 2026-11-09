'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '..', '..', '.env.local');
const result = dotenv.config({ path: envPath, override: true });

if (result.error) {
  throw new Error(
    'Créez un fichier .env.local avec la configuration locale avant de lancer ce script.',
  );
}

process.env.DAE_LOCAL_ENV = 'true';
