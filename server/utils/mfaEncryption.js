const crypto = require('crypto');

/**
 * MFA Secret Encryption Utility
 * Uses AES-256-GCM for authenticated encryption
 * Key derived from MFA_ENCRYPTION_KEY env var using PBKDF2
 */

let encryptionKey = null;

function getEncryptionKey() {
  if (encryptionKey) return encryptionKey;
  
  const masterKey = process.env.MFA_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error('MFA_ENCRYPTION_KEY environment variable is required for MFA secret encryption');
  }
  
  // Derive 32-byte key using PBKDF2
  encryptionKey = crypto.pbkdf2Sync(masterKey, 'silverstar-mfa-salt', 100000, 32, 'sha256');
  return encryptionKey;
}

/**
 * Encrypt MFA secret
 * @param {string} secret - Base32 TOTP secret
 * @returns {string} - Encrypted secret in format: iv:authTag:encryptedData (all base64)
 */
function encryptMFASecret(secret) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encryptedData (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt MFA secret
 * @param {string} encryptedSecret - Encrypted secret in format: iv:authTag:encryptedData
 * @returns {string} - Decrypted Base32 secret
 */
function decryptMFASecret(encryptedSecret) {
  if (!encryptedSecret) return null;
  
  const key = getEncryptionKey();
  const parts = encryptedSecret.split(':');
  if (parts.length !== 3) {
    // Legacy unencrypted secret - return as-is for migration
    return encryptedSecret;
  }
  
  const [ivB64, authTagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Check if secret is encrypted (new format)
 */
function isEncrypted(secret) {
  if (!secret) return false;
  const parts = secret.split(':');
  return parts.length === 3;
}

module.exports = {
  encryptMFASecret,
  decryptMFASecret,
  isEncrypted,
};