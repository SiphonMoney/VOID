// Encryption utilities for intent encryption before sending to TEE
// Uses Web Crypto API for hybrid encryption (RSA-OAEP + AES-GCM)

class IntentEncryption {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
    this.teeEndpoint = 'http://localhost:3001/api'; // Default TEE endpoint
    this.cachedPublicKey = null; // Cache TEE public key to avoid repeated fetches
    this.publicKeyCacheTime = null;
    this.publicKeyCacheTTL = 3600000; // Cache for 1 hour
  }

  /**
   * Fetch TEE public key from server
   * @returns {Promise<CryptoKey>} TEE public key in JWK format
   */
  async fetchTEEPublicKey() {
    // Check cache first
    if (this.cachedPublicKey && this.publicKeyCacheTime) {
      const cacheAge = Date.now() - this.publicKeyCacheTime;
      if (cacheAge < this.publicKeyCacheTTL) {
        console.log('[AnonyMaus] Using cached TEE public key');
        return this.cachedPublicKey;
      }
    }

    try {
      console.log('[AnonyMaus] Fetching TEE public key from server...');
      const baseUrl = this.teeEndpoint.replace('/api', '');
      const response = await fetch(`${baseUrl}/api/public-key`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch TEE public key: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success || !data.publicKey || !data.publicKey.jwk) {
        throw new Error('Invalid public key response from TEE server');
      }

      const jwk = { ...data.publicKey.jwk };
      if (jwk.alg) {
        console.warn(`[AnonyMaus] ⚠️  JWK alg "${jwk.alg}" provided, clearing for import`);
        delete jwk.alg;
      }
      if (Array.isArray(jwk.key_ops) && jwk.key_ops.length > 0) {
        jwk.key_ops = ['encrypt'];
      }

      // Import public key from JWK format
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        {
          name: 'RSA-OAEP',
          hash: 'SHA-256'
        },
        false, // not extractable
        ['encrypt']
      );

      // Cache the key
      this.cachedPublicKey = publicKey;
      this.publicKeyCacheTime = Date.now();

      console.log('[AnonyMaus] ✅ TEE public key fetched and cached');
      console.log(`[AnonyMaus] Public Key ID: ${data.publicKey.keyId || 'unknown'}`);
      
      return publicKey;
    } catch (error) {
      console.error('[AnonyMaus] ❌ Failed to fetch TEE public key:', error);
      throw new Error(`TEE public key fetch failed: ${error.message}`);
    }
  }

  /**
   * Generate random AES-GCM key for symmetric encryption
   */
  async generateAESKey() {
    return await crypto.subtle.generateKey(
      {
        name: this.algorithm,
        length: this.keyLength
      },
      true, // extractable (needed to encrypt it with RSA)
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt intent using hybrid encryption (RSA-OAEP + AES-GCM)
   * This ensures only the TEE can decrypt the intent
   * @param {Object} signedIntent - The signed intent object
   * @returns {Promise<Object>} Encrypted intent with metadata
   */
  async encryptIntent(signedIntent) {
    try {
      console.log('[AnonyMaus] Starting hybrid encryption (RSA-OAEP + AES-GCM)...');
      
      // Step 1: Convert intent to JSON string
      // Clean signedIntent to remove any non-serializable properties (like Transaction objects)
      // The signedTransaction might be a Solana Transaction object with a serialize() method
      // We need to extract only the serializable properties
      const cleanedIntent = {
        ...signedIntent,
        // Clean signedTransaction - extract only plain object properties
        signedTransaction: signedIntent.signedTransaction 
          ? (() => {
              const st = signedIntent.signedTransaction;
              // If it has a serialize method, it's likely a Transaction object - extract plain properties
              if (typeof st === 'object' && st !== null && typeof st.serialize === 'function') {
                return {
                  signature: st.signature,
                  publicKey: st.publicKey,
                  message: st.message,
                  intentHash: st.intentHash
                };
              }
              // If it's already a plain object, check if it has serialize property and remove it
              if (typeof st === 'object' && st !== null) {
                const cleaned = { ...st };
                // Remove serialize method if it exists
                if ('serialize' in cleaned) {
                  delete cleaned.serialize;
                }
                return cleaned;
              }
              return st;
            })()
          : signedIntent.signedTransaction
      };
      
      const intentString = JSON.stringify(cleanedIntent);
      const intentBytes = new TextEncoder().encode(intentString);
      console.log(`[AnonyMaus] Intent size: ${intentBytes.length} bytes`);

      // Step 2: Fetch TEE public key (or use cached)
      const teePublicKey = await this.fetchTEEPublicKey();

      // Step 3: Generate random AES-GCM key for symmetric encryption
      const aesKey = await this.generateAESKey();
      console.log('[AnonyMaus] ✅ AES key generated');

      // Step 4: Generate random IV (initialization vector) for AES-GCM
      const iv = crypto.getRandomValues(new Uint8Array(12));
      console.log('[AnonyMaus] ✅ IV generated');

      // Step 5: Encrypt intent data with AES-GCM
      const encryptedData = await crypto.subtle.encrypt(
        {
          name: this.algorithm,
          iv: iv
        },
        aesKey,
        intentBytes
      );
      console.log(`[AnonyMaus] ✅ Intent encrypted with AES-GCM (${encryptedData.byteLength} bytes)`);

      // Step 6: Export AES key and encrypt it with TEE public key (RSA-OAEP)
      const exportedAESKey = await crypto.subtle.exportKey('raw', aesKey);
      const encryptedAESKey = await crypto.subtle.encrypt(
        {
          name: 'RSA-OAEP'
        },
        teePublicKey,
        exportedAESKey
      );
      console.log(`[AnonyMaus] ✅ AES key encrypted with TEE public key (RSA-OAEP, ${encryptedAESKey.byteLength} bytes)`);

      // Step 7: Convert to base64 for transmission
      const encryptedArray = Array.from(new Uint8Array(encryptedData));
      const encryptedBase64 = btoa(String.fromCharCode(...encryptedArray));
      
      const encryptedKeyArray = Array.from(new Uint8Array(encryptedAESKey));
      const encryptedKeyBase64 = btoa(String.fromCharCode(...encryptedKeyArray));
      
      const ivBase64 = btoa(String.fromCharCode(...iv));

      console.log('[AnonyMaus] ✅ Hybrid encryption complete');
      console.log(`[AnonyMaus] Encrypted payload: ${encryptedBase64.length} bytes`);
      console.log(`[AnonyMaus] Encrypted key: ${encryptedKeyBase64.length} bytes`);

      return {
        encrypted: encryptedBase64,
        encryptedKey: encryptedKeyBase64, // AES key encrypted with TEE public key
        encryptedKeyFormat: 'rsa-oaep', // Indicates hybrid encryption format
        iv: ivBase64,
        algorithm: this.algorithm,
        timestamp: Date.now(),
        encryptionType: 'hybrid' // Mark as hybrid encryption
      };
    } catch (error) {
      console.error('[AnonyMaus] ❌ Encryption error:', error);
      throw new Error('Failed to encrypt intent: ' + error.message);
    }
  }

  /**
   * Decrypt intent (for testing/debugging - TEE will do this in production)
   * NOTE: This requires the TEE private key, which should NEVER be available client-side
   * This is only for testing purposes
   */
  async decryptIntent(encryptedIntent) {
    // This should NOT be used in production - decryption happens server-side in TEE
    console.warn('[AnonyMaus] ⚠️  Client-side decryption is for testing only!');
    console.warn('[AnonyMaus] ⚠️  In production, only the TEE can decrypt with its private key');
    
    if (encryptedIntent.encryptedKeyFormat === 'rsa-oaep') {
      throw new Error('Cannot decrypt hybrid-encrypted intent client-side - requires TEE private key');
    }
    
    // Legacy format decryption (for backward compatibility testing only)
    try {
      const keyBytes = Uint8Array.from(atob(encryptedIntent.key), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: this.algorithm, length: this.keyLength },
        false,
        ['decrypt']
      );

      const iv = Uint8Array.from(atob(encryptedIntent.iv), c => c.charCodeAt(0));
      const encryptedBytes = Uint8Array.from(atob(encryptedIntent.encrypted), c => c.charCodeAt(0));

      const decryptedData = await crypto.subtle.decrypt(
        {
          name: this.algorithm,
          iv: iv
        },
        key,
        encryptedBytes
      );

      const decryptedString = new TextDecoder().decode(decryptedData);
      return JSON.parse(decryptedString);
    } catch (error) {
      console.error('[AnonyMaus] Decryption error:', error);
      throw new Error('Failed to decrypt intent: ' + error.message);
    }
  }

  /**
   * Clear cached TEE public key (force refresh on next encryption)
   */
  clearPublicKeyCache() {
    this.cachedPublicKey = null;
    this.publicKeyCacheTime = null;
    console.log('[AnonyMaus] TEE public key cache cleared');
  }

  /**
   * Create intent hash for signing
   * @param {Object} intent - The intent object
   * @returns {Promise<string>} Hash of the intent
   */
  async createIntentHash(intent) {
    const intentString = JSON.stringify(intent);
    const intentBytes = new TextEncoder().encode(intentString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', intentBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// IntentEncryption is available globally when loaded via importScripts

