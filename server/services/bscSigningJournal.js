'use strict';

const crypto = require('node:crypto');

function encryptionKey() {
  const mnemonic = String(process.env.BSC_SIGNER_MNEMONIC || '').trim().normalize('NFKD');
  if (!mnemonic) throw new Error('BSC_SIGNER_MNEMONIC manquant pour le journal local de signature.');
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(mnemonic, 'utf8'),
    Buffer.from('DAE-BSC-SIGNING-JOURNAL-v1', 'utf8'),
    Buffer.from('signed-transaction-recovery', 'utf8'),
    32,
  ));
}

function encryptSignedTransaction(rawTransaction) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(rawTransaction, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSignedTransaction(serialized) {
  const [ivText, tagText, encryptedText, extra] = String(serialized || '').split('.');
  if (!ivText || !tagText || !encryptedText || extra !== undefined) throw new Error('Journal de transaction signée invalide.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptSignedTransaction, decryptSignedTransaction };
