// Transaction processing module
// Handles Solana transaction submission and execution

import { Connection, PublicKey, Transaction } from '@solana/web3.js';

/**
 * Submit Solana transaction to the network
 * @param {Object} transactionData - Transaction data
 * @param {Object} signedIntent - Signed intent
 * @param {string} rpcUrl - RPC URL
 * @param {Function} log - Logging function
 * @returns {Promise<Object>} Transaction result
 */
export async function submitSolanaTransaction(transactionData, signedIntent, rpcUrl, log) {
  log('Submitting Solana transaction to network...', 'info');
  
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Deserialize transaction if needed
    let transaction;
    if (transactionData.serialized) {
      transaction = Transaction.from(Buffer.from(transactionData.serialized, 'base64'));
    } else {
      // Build transaction from instructions if serialized not available
      transaction = new Transaction();
      if (transactionData.instructions) {
        // Add instructions to transaction
        // This is simplified - full implementation would parse instruction data
      }
    }
    
    // In production, TEE would:
    // 1. Verify signed intent
    // 2. Execute transaction using user's deposited funds
    // 3. Submit to Solana network
    // 4. Return transaction signature
    
    // For simulation, return a mock signature
    const mockSignature = 'mock_' + Date.now().toString(36);
    
    log(`✅ Transaction submitted: ${mockSignature}`, 'success');
    
    return {
      success: true,
      signature: mockSignature,
      transaction: transactionData
    };
  } catch (error) {
    log(`❌ Transaction submission failed: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Wait for transaction confirmation
 * @param {string} signature - Transaction signature
 * @param {string} rpcUrl - RPC URL
 * @param {Function} log - Logging function
 * @param {number} maxWaitTime - Maximum wait time in ms
 * @returns {Promise<Object>} Transaction confirmation
 */
export async function waitForTransactionConfirmation(signature, rpcUrl, log, maxWaitTime = 120000) {
  log(`⏳ Waiting for transaction confirmation: ${signature}`, 'info');
  
  const connection = new Connection(rpcUrl, 'confirmed');
  const startTime = Date.now();
  
  return new Promise(async (resolve, reject) => {
    const checkTransaction = async () => {
      try {
        const status = await connection.getSignatureStatus(signature);
        
        if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
          log(`✅ Transaction confirmed: ${signature}`, 'success');
          resolve(status.value);
        } else if (status?.value?.err) {
          log(`❌ Transaction failed: ${JSON.stringify(status.value.err)}`, 'error');
          reject(new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`));
        } else if (Date.now() - startTime > maxWaitTime) {
          log(`⏱️ Transaction confirmation timeout`, 'error');
          reject(new Error('Transaction confirmation timeout'));
        } else {
          setTimeout(checkTransaction, 2000); // Check every 2 seconds
        }
      } catch (error) {
        if (Date.now() - startTime > maxWaitTime) {
          reject(error);
        } else {
          setTimeout(checkTransaction, 2000);
        }
      }
    };
    
    checkTransaction();
  });
}
