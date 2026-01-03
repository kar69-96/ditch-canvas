const crypto = require('crypto');

function getKey() {
  const raw = process.env.INTEGRATIONS_TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error('INTEGRATIONS_TOKEN_ENC_KEY is not set');
  }
  // Accept base64 or utf-8; normalize to 32 bytes.
  let keyBuf;
  try {
    keyBuf = Buffer.from(raw, 'base64');
    if (keyBuf.length === 32) return keyBuf;
  } catch (_) {
    /* fallthrough */
  }
  keyBuf = Buffer.from(raw, 'utf-8');
  if (keyBuf.length !== 32) {
    throw new Error('INTEGRATIONS_TOKEN_ENC_KEY must decode to 32 bytes (256-bit key)');
  }
  return keyBuf;
}

function encryptToken(payload) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

function decryptToken(serialized) {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = (serialized || '').split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted token format');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}

module.exports = {
  encryptToken,
  decryptToken,
};




