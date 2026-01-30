// Signature verification module
// Handles Solana Ed25519 signature verification

import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import crypto from 'crypto';

/**
 * Verify Solana Ed25519 signature on intent hash
 * @param {Object} intent - The signed intent
 * @param {Object} transactionData - Transaction data (optional)
 * @param {Function} log - Logging function
 * @returns {boolean} True if signature is valid
 */
export function verifySolanaSignature(intent, transactionData, log) {
  try {
    log('Verifying Solana signature...', 'info');
    
    if (!intent.signature && !intent.signedTransaction?.signature) {
      throw new Error('Missing signature or signed transaction');
    }
    
    // Get user's public key
    const userPubkey = new PublicKey(intent.signer);
    
    // Get signature (from intent.signature or signedTransaction.signature)
    let signatureHex = intent.signature || intent.signedTransaction?.signature;
    if (!signatureHex) {
      throw new Error('No signature found');
    }
    
    // Remove 0x prefix if present
    const originalSignature = signatureHex;
    signatureHex = signatureHex.replace('0x', '');
    
    log(`   Original signature: ${originalSignature.substring(0, 40)}...`, 'info');
    
    // Convert signature to bytes
    let signatureBytes;
    let signatureFormat = 'unknown';
    const signatureAttempts = [];
    
    // Try hex first (what extension sends)
    try {
      signatureBytes = Buffer.from(signatureHex, 'hex');
      if (signatureBytes.length === 64) {
        signatureFormat = 'hex';
        log(`   Signature format: hex (64 bytes)`, 'info');
        signatureAttempts.push({ format: 'hex', bytes: signatureBytes });
      } else {
        throw new Error(`Hex decode gave ${signatureBytes.length} bytes, expected 64`);
      }
    } catch (e) {
      signatureAttempts.push({ format: 'hex', error: e.message });
      // Try base58 (Solana's native format)
      log(`   Hex decode failed (${e.message}), trying base58...`, 'info');
      try {
        signatureBytes = Buffer.from(bs58.decode(signatureHex));
        if (signatureBytes.length === 64) {
          signatureFormat = 'base58';
          log(`   Signature format: base58 (64 bytes)`, 'info');
          signatureAttempts.push({ format: 'base58', bytes: signatureBytes });
        } else {
          throw new Error(`Base58 decode gave ${signatureBytes.length} bytes, expected 64`);
        }
      } catch (e2) {
        signatureAttempts.push({ format: 'base58', error: e2.message });
        signatureBytes = Buffer.from(signatureHex, 'hex');
        signatureFormat = 'hex (fallback)';
        log(`   ⚠️  Using hex fallback (length: ${signatureBytes.length} bytes)`, 'warn');
      }
    }
    
    if (signatureBytes.length !== 64) {
      log(`   ⚠️  Warning: Signature is ${signatureBytes.length} bytes, expected 64 for Ed25519`, 'warn');
    }
    
    // Reconstruct the message that was signed
    let intentHash = intent.signedTransaction?.intentHash || 
                     intent.signedTransaction?.message || 
                     intent.intentHash || 
                     '';
    
    log(`   Intent hash source: ${intent.signedTransaction?.intentHash ? 'signedTransaction.intentHash' : intent.signedTransaction?.message ? 'signedTransaction.message' : 'intent.intentHash'}`, 'info');
    
    // If still empty, reconstruct it from the intent data
    if (!intentHash || intentHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      log(`⚠️  Intent hash is missing, attempting to reconstruct...`, 'warn');
      
      try {
        const { signature, signedTransaction, intentHash: _, signer: __, ...intentData } = intent;

        if ('privacy' in intentData) {
          delete intentData.privacy;
        }
        
        if (!intentData.instructions && intent.transaction?.instructions) {
          Object.assign(intentData, {
            instructions: intent.transaction.instructions,
            timestamp: intent.timestamp || Date.now(),
            dapp: intent.metadata?.dappUrl || intent.metadata?.dappName || 'unknown',
            action: intent.action || 'transaction',
            transactionType: intent.transactionType || 'UNKNOWN'
          });
        }
        
        const intentString = JSON.stringify(intentData);
        const intentBytes = Buffer.from(intentString, 'utf8');
        const hashBuffer = crypto.createHash('sha256').update(intentBytes).digest();
        intentHash = '0x' + hashBuffer.toString('hex');
        log(`   ✅ Reconstructed intent hash: ${intentHash.substring(0, 20)}...`, 'info');
      } catch (e) {
        log(`   ❌ Failed to reconstruct intent hash: ${e.message}`, 'error');
        throw new Error('Cannot verify signature without intent hash');
      }
    }
    
    // Convert intent hash to message bytes (UTF-8 encoded string, not hex bytes)
    // Phantom's signMessage signs the STRING representation, not hex bytes
    const messageBytes = Buffer.from(intentHash, 'utf8');
    
    // Get public key bytes
    const publicKeyBytes = userPubkey.toBytes();
    
    // Verify Ed25519 signature
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    );
    
    if (isValid) {
      log('✅ Signature verification passed', 'success');
    } else {
      log('❌ Signature verification failed', 'error');
      log(`   Attempted formats: ${signatureAttempts.map(a => a.format).join(', ')}`, 'error');
    }
    
    return isValid;
  } catch (error) {
    log(`❌ Signature verification error: ${error.message}`, 'error');
    return false;
  }
}
