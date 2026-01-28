// server/inco-handler.js
// Handles Inco FHE encryption/decryption

import { IncoSVM } from '@inco/solana-sdk';
import { Connection } from '@solana/web3.js';

class IncoHandler {
  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
    );
    this.incoClient = null;
    this.initialize();
  }

  async initialize() {
    try {
      this.incoClient = new IncoSVM(this.connection);
      console.log('✅ [Inco] Handler initialized');
    } catch (error) {
      console.error('❌ [Inco] Initialization failed:', error);
    }
  }

  /**
   * Encrypt data using Inco FHE
   */
  async encrypt(data) {
    if (!this.incoClient) {
      throw new Error('Inco client not initialized');
    }

    console.log('🔐 [Inco] Encrypting data with FHE...');
    
    const buffer = Buffer.from(data);
    const encrypted = await this.incoClient.encrypt(buffer);
    
    console.log('✅ [Inco] Data encrypted');
    
    return {
      encryptedData: Array.from(encrypted),
      timestamp: Date.now()
    };
  }

  /**
   * Decrypt data using Inco FHE (only in TEE)
   */
  async decrypt(encryptedData) {
    if (!this.incoClient) {
      throw new Error('Inco client not initialized');
    }

    console.log('🔓 [Inco] Decrypting data in TEE...');
    
    const encrypted = new Uint8Array(encryptedData);
    const decrypted = await this.incoClient.decrypt(encrypted);
    
    console.log('✅ [Inco] Data decrypted');
    
    return decrypted;
  }

  /**
   * Decrypt and parse intent
   */
  async decryptIntent(encryptedIntent) {
    try {
      const decrypted = await this.decrypt(encryptedIntent.encrypted);
      const intentJSON = decrypted.toString();
      return JSON.parse(intentJSON);
    } catch (error) {
      console.error('❌ [Inco] Intent decryption failed:', error);
      throw error;
    }
  }
}

export { IncoHandler };