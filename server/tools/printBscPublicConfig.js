'use strict';

const { HDNodeWallet } = require('ethers');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.signer') });

const phrase = process.env.BSC_SIGNER_MNEMONIC || '';
if (!phrase.trim()) {
  console.error('Définissez BSC_SIGNER_MNEMONIC uniquement dans un terminal hors ligne que vous contrôlez.');
  process.exit(1);
}

const customerPath = process.env.BSC_CUSTOMER_DERIVATION_PATH || "m/44'/60'/0'/0";
const masterPath = process.env.BSC_MASTER_DERIVATION_PATH || "m/44'/60'/1'/0/0";
const gasPath = process.env.BSC_GAS_DERIVATION_PATH || "m/44'/60'/2'/0/0";
const customerNode = HDNodeWallet.fromPhrase(phrase, '', customerPath);
const master = HDNodeWallet.fromPhrase(phrase, '', masterPath);
const gas = HDNodeWallet.fromPhrase(phrase, '', gasPath);

console.log(JSON.stringify({
  chainId: 56,
  customerDerivationPath: `${customerPath}/{accountIndex}`,
  customerXpub: customerNode.neuter().extendedKey,
  masterDerivationPath: masterPath,
  masterAddress: master.address,
  gasDerivationPath: gasPath,
  gasAddress: gas.address,
}, null, 2));
