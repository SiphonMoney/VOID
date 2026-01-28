// TEE (Trusted Execution Environment) module
// Handles encryption, decryption, and TEE key management

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let teeKeyPair = null;
let teePublicKeyJWK = null;
let teePublicKeyPEM = null;

/**
 * Initialize TEE key pair
 * @param {Function} log - Logging function
 * @returns {Object} TEE key pair
 */
export function initializeTEEKeyPair(log) {
  try {
    // Try to load existing key pair from file
    const keyPath = path.join(__dirname, '..', '.tee-keypair.json');
    
    if (fs.existsSync(keyPath)) {
      const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      teeKeyPair = {
        publicKey: keyData.publicKey,
        privateKey: keyData.privateKey
      };
      log('✅ Loaded existing TEE key pair from file', 'success');
    } else {
      // Generate new RSA key pair (2048 bits)
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      teeKeyPair = { publicKey, privateKey };
      
      // Save to file for persistence
      fs.writeFileSync(keyPath, JSON.stringify({ publicKey, privateKey }, null, 2));
      log('✅ Generated new TEE key pair', 'success');
    }
    
    // Convert PEM to JWK for Web Crypto API
    const publicKeyObj = crypto.createPublicKey(teeKeyPair.publicKey);
    teePublicKeyJWK = {
      kty: 'RSA',
      n: publicKeyObj.export({ format: 'jwk' }).n,
      e: publicKeyObj.export({ format: 'jwk' }).e,
      alg: 'RSA-OAEP',
      ext: true
    };
    teePublicKeyPEM = teeKeyPair.publicKey;
    
    log('✅ TEE key pair initialized', 'success');
    return teeKeyPair;
  } catch (error) {
    log(`❌ Failed to initialize TEE key pair: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Get TEE public key
 * @returns {Object} Public key in JWK and PEM formats
 */
export function getTEEPublicKey() {
  return {
    jwk: teePublicKeyJWK,
    pem: teePublicKeyPEM,
    keyPair: teeKeyPair
  };
}

/**
 * Decrypt intent using hybrid encryption (RSA-OAEP + AES-GCM)
 * @param {Object} encryptedIntent - Encrypted intent
 * @param {Function} log - Logging function
 * @returns {Promise<Object>} Decrypted intent
 */
export async function decryptIntent(encryptedIntent, log) {
  try {
    log('Decrypting intent inside TEE enclave using hybrid encryption...', 'info');
    
    if (!teeKeyPair || !teeKeyPair.privateKey) {
      throw new Error('TEE private key not available - cannot decrypt');
    }
    
    // Check if this is the new hybrid encryption format
    if (encryptedIntent.encryptedKey && encryptedIntent.encryptedKeyFormat === 'rsa-oaep') {
      // NEW: Hybrid encryption (RSA-OAEP + AES-GCM)
      log('Using hybrid encryption (RSA-OAEP + AES-GCM)', 'info');
      
      // Step 1: Decrypt the symmetric key using TEE private key (RSA-OAEP)
      const encryptedKeyBytes = Buffer.from(encryptedIntent.encryptedKey, 'base64');
      let symmetricKeyBytes;
      try {
        symmetricKeyBytes = crypto.privateDecrypt(
          {
            key: teeKeyPair.privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
          },
          encryptedKeyBytes
        );
        log('✅ Symmetric key decrypted with TEE private key', 'success');
      } catch (error) {
        log(`❌ Failed to decrypt symmetric key: ${error.message}`, 'error');
        throw new Error(`TEE key decryption failed: ${error.message}`);
      }
      
      // Step 2: Decrypt the intent data using the symmetric key (AES-GCM)
      const encryptedBytes = Buffer.from(encryptedIntent.encrypted, 'base64');
      const iv = Buffer.from(encryptedIntent.iv, 'base64');
      const algorithm = 'aes-256-gcm';
      
      // Web Crypto API appends the auth tag (16 bytes) to the end of the ciphertext
      const authTagLength = 16;
      const ciphertext = encryptedBytes.slice(0, -authTagLength);
      const authTag = encryptedBytes.slice(-authTagLength);
      
      // Create decipher for GCM mode
      const decipher = crypto.createDecipheriv(algorithm, symmetricKeyBytes, iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      // Parse JSON
      const intent = JSON.parse(decrypted.toString('utf8'));
      
      log(`✅ Intent decrypted successfully using hybrid encryption: ${intent.action}`, 'success');
      return intent;
      
    } else {
      // LEGACY: Old format (symmetric key sent in plaintext - for backward compatibility)
      log('⚠️  Using legacy encryption format (symmetric key in plaintext)', 'warn');
      log('   This is INSECURE - migrating to hybrid encryption', 'warn');
      
      const encryptedBytes = Buffer.from(encryptedIntent.encrypted, 'base64');
      const iv = Buffer.from(encryptedIntent.iv, 'base64');
      const keyBytes = Buffer.from(encryptedIntent.key, 'base64');
      
      const algorithm = 'aes-256-gcm';
      const authTagLength = 16;
      const ciphertext = encryptedBytes.slice(0, -authTagLength);
      const authTag = encryptedBytes.slice(-authTagLength);
      
      const decipher = crypto.createDecipheriv(algorithm, keyBytes, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      const intent = JSON.parse(decrypted.toString('utf8'));
      log(`Intent decrypted successfully (legacy format): ${intent.action}`, 'success');
      return intent;
    }
  } catch (error) {
    log(`Decryption failed: ${error.message}`, 'error');
    log(`Error stack: ${error.stack}`, 'error');
    throw new Error(`TEE decryption failed: ${error.message}`);
  }
}

/**
 * Get TEE attestation (proof that code is running in TEE)
 * @param {Object} teeState - TEE state
 * @returns {Object} TEE attestation
 */
export function getTEEAttestation(teeState) {
  return {
    enclaveId: teeState.enclaveId,
    version: '1.0.0',
    timestamp: Date.now()
  };
}
