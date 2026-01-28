// TEE Client
// Handles communication with TEE network for intent approval

class TEEClient {
  constructor() {
    // TEE server endpoint - defaults to localhost for development
    // In production, this would be the actual TEE network endpoint
    this.endpoint = 'http://localhost:3001/api'; // Local TEE server
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Send encrypted intent to TEE for approval
   * @param {Object} encryptedIntent - The encrypted intent
   * @returns {Promise<Object>} TEE approval response
   */
  async requestApproval(encryptedIntent) {
    try {
      console.log(`[AnonyMaus TEE Client] Sending encrypted intent to TEE server: ${this.endpoint}/approve`);
      console.log(`[AnonyMaus TEE Client] Encrypted payload:`, {
        algorithm: encryptedIntent.algorithm,
        encryptionType: encryptedIntent.encryptionType || 'legacy',
        encryptedLength: encryptedIntent.encrypted?.length || 0,
        ivLength: encryptedIntent.iv?.length || 0,
        encryptedKeyLength: encryptedIntent.encryptedKey?.length || 0,
        keyLength: encryptedIntent.key?.length || 0 // Legacy format
      });
      
      // Send to TEE server
      const response = await fetch(`${this.endpoint}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          encryptedIntent: encryptedIntent
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`TEE request failed: ${errorData.error || response.statusText} (${response.status})`);
      }
      
      const data = await response.json();
      
      console.log(`[AnonyMaus TEE Client] TEE approval received:`, {
        approved: data.approved,
        enclaveId: data.enclaveId,
        route: data.executionPlan?.route,
        signature: data.signature?.substring(0, 20) + '...'
      });
      
      return data;
      
    } catch (error) {
      // If TEE server is not available, fall back to mock (for development)
      if (error.name === 'AbortError' || error.message.includes('fetch')) {
        console.warn(`[AnonyMaus TEE Client] TEE server not available, using mock approval`);
        console.warn(`[AnonyMaus TEE Client] Make sure TEE server is running: npm start in server/ folder`);
        
        // Fallback to mock for development
        return {
          approved: true,
          signature: '0x' + '0'.repeat(130), // Mock TEE signature
          executionPlan: {
            route: 'uniswap-v3',
            estimatedPrice: '0.001',
            maxSlippage: '0.01'
          },
          enclaveId: 'mock-enclave',
          timestamp: Date.now()
        };
      }
      
      throw new Error(`TEE approval failed: ${error.message}`);
    }
  }

  /**
   * Submit transaction to Flashbots via TEE
   * TEE handles transaction signing and Flashbots submission internally
   * @param {Object} transaction - EIP-1559 transaction object
   * @param {string} chainId - Chain ID
   * @param {Object} signedIntent - Signed intent from user (for fund pulling authorization)
   * @returns {Promise<string>} Transaction hash
   */
  async submitTransaction(transaction, chainId, signedIntent) {
    try {
      console.log(`[AnonyMaus TEE Client] Submitting transaction to Flashbots via TEE: ${this.endpoint}/submit-transaction`);
      
      const response = await fetch(`${this.endpoint}/submit-transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transaction,
          chainId,
          signedIntent // Pass signed intent for fund pulling authorization
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        // Include full error data in error message for parsing
        const errorMessage = `TEE transaction submission failed: ${errorData.error || response.statusText} (${response.status})`;
        const fullError = new Error(errorMessage);
        fullError.errorData = errorData; // Attach error data for parsing
        throw fullError;
      }
      
      const data = await response.json();
      
      console.log(`[AnonyMaus TEE Client] Transaction submission result:`, {
        success: data.success,
        txHash: data.txHash?.substring(0, 20) + '...',
        status: data.status
      });
      
      if (!data.success) {
        throw new Error(`TEE transaction submission failed: ${data.error || 'Unknown error'}`);
      }
      
      if (!data.txHash) {
        throw new Error('TEE did not return transaction hash');
      }
      
      return data.txHash;
      
    } catch (error) {
      console.error(`[AnonyMaus TEE Client] Transaction submission error:`, error);
      throw new Error(`TEE transaction submission failed: ${error.message}`);
    }
  }

  /**
   * Check TEE network status
   * @returns {Promise<boolean>} True if TEE is available
   */
  async checkStatus() {
    try {
      // TODO: Implement actual status check
      return true;
    } catch (error) {
      return false;
    }
  }
}

// TEEClient is available globally when loaded via importScripts

