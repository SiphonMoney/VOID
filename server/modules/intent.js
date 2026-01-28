// Intent validation and processing module
// Handles intent validation, expiry checks, and processing

import crypto from 'crypto';

/**
 * Validate intent expiry and nonce (replay protection)
 * @param {Object} intent - The intent to validate
 * @param {Object} processedIntents - Map of processed intents
 * @param {Function} log - Logging function
 * @param {boolean} allowAlreadyApproved - If true, allows intents that were already approved
 * @returns {boolean} True if valid
 */
export function validateIntentExpiryAndNonce(intent, processedIntents, log, allowAlreadyApproved = false) {
  try {
    log('Validating intent expiry and nonce...', 'info');
    
    // Check expiry timestamp
    if (intent.expiry) {
      const now = Date.now();
      const expiry = typeof intent.expiry === 'number' ? intent.expiry : parseInt(intent.expiry);
      
      if (now > expiry) {
        const expiredBy = (now - expiry) / 1000; // seconds
        log(`❌ Intent has expired: ${expiredBy.toFixed(1)} seconds ago`, 'error');
        throw new Error(`Intent expired ${expiredBy.toFixed(1)} seconds ago`);
      }
      
      const timeUntilExpiry = (expiry - now) / 1000; // seconds
      log(`✅ Intent expiry valid: expires in ${timeUntilExpiry.toFixed(1)} seconds`, 'success');
    } else {
      log('⚠️  Intent has no expiry timestamp - allowing but warning', 'warn');
    }
    
    // Check timestamp is recent (prevent very old intents)
    if (intent.timestamp) {
      const timestamp = typeof intent.timestamp === 'number' ? intent.timestamp : parseInt(intent.timestamp);
      const age = Date.now() - timestamp;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (age > maxAge) {
        log(`❌ Intent timestamp too old: ${(age / 1000 / 60 / 60).toFixed(1)} hours`, 'error');
        throw new Error('Intent timestamp is too old (max 24 hours)');
      }
      
      log(`✅ Intent timestamp valid: ${(age / 1000).toFixed(1)} seconds old`, 'info');
    }
    
    // Check if intent hash was already processed (replay protection)
    if (intent.intentHash && processedIntents.has(intent.intentHash)) {
      const processed = processedIntents.get(intent.intentHash);
      const processedAt = new Date(processed.processedAt || Date.now()).toISOString();
      
      // If allowAlreadyApproved is true and the intent was approved (not executed), allow it
      if (allowAlreadyApproved && processed.status === 'approved') {
        log(`✅ Intent was already approved at ${processedAt}, allowing execution`, 'info');
      } else {
        log(`❌ Intent hash already processed at ${processedAt}`, 'error');
        throw new Error('Intent hash already processed (replay attack detected)');
      }
    }
    
    log('✅ Intent expiry and nonce validation passed', 'success');
    return true;
  } catch (error) {
    log(`❌ Intent validation failed: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Process intent - route optimization, pricing, etc.
 * @param {Object} intent - The intent to process
 * @param {Function} log - Logging function
 * @returns {Object} Execution plan
 */
export function processIntent(intent, log) {
  log('Processing intent inside TEE enclave...', 'info');
  
  const executionPlan = {
    route: 'raydium', // Default to Raydium for Solana
    estimatedPrice: '0.0005', // Solana fees are typically lower
    maxSlippage: intent.limits?.maxSlippage || '0.01',
    gasEstimate: '5000', // Solana uses compute units, not gas
    timestamp: Date.now()
  };
  
  // Check instructions for Raydium program IDs
  const instructions = intent.transaction?.instructions || [];
  const raydiumProgramIds = [
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
    'RVKd61ztZW9GUwhRbbLoYVRE5Xf9B2t3sc6qwfqE3zH', // Raydium CLMM (devnet)
    'CPMMoo8L3F4NbTegBCKVNunggL1tnt2ec5zM1YkqFhL2', // Raydium CPMM
  ];
  
  let isRaydium = false;
  for (const instruction of instructions) {
    const programId = instruction.programId?.toString() || instruction.programId || '';
    if (raydiumProgramIds.some(id => programId.includes(id) || id.includes(programId))) {
      isRaydium = true;
      break;
    }
  }
  
  // Check metadata for Raydium
  const dappName = intent.metadata?.dappName?.toLowerCase() || '';
  const dappUrl = intent.metadata?.dappUrl?.toLowerCase() || '';
  if (dappName.includes('raydium') || dappUrl.includes('raydium')) {
    isRaydium = true;
  }
  
  if (isRaydium) {
    executionPlan.route = 'raydium';
    executionPlan.estimatedPrice = '0.0005'; // Raydium swap fee estimate
  } else if (intent.action === 'swap') {
    // Generic Solana swap (could be Jupiter, Orca, etc.)
    executionPlan.route = 'solana-swap';
    executionPlan.estimatedPrice = '0.0005';
  } else if (intent.action === 'approve') {
    executionPlan.route = 'solana-approve';
    executionPlan.estimatedPrice = '0.0001';
  }
  
  log(`Execution plan created: ${executionPlan.route}`, 'success');
  return executionPlan;
}

/**
 * Generate TEE approval signature
 * @param {Object} intent - The intent
 * @param {Object} executionPlan - The execution plan
 * @param {Object} teeState - TEE state
 * @param {Function} log - Logging function
 * @returns {string} TEE signature
 */
export function generateTEESignature(intent, executionPlan, teeState, log) {
  log('Generating TEE approval signature...', 'info');
  
  // In production, TEE would:
  // 1. Sign with TEE's private key (stored securely in hardware)
  // 2. Return signature as proof of TEE approval
  // 3. This signature proves the TEE validated and approved the intent
  
  // For simulation, generate a deterministic signature based on intent data
  // In real TEE, this would be a cryptographic signature using TEE's private key
  const signatureData = JSON.stringify({
    intentHash: intent.intentHash,
    executionPlan,
    enclaveId: teeState.enclaveId,
    timestamp: Date.now()
  });
  
  const signature = '0x' + crypto.createHash('sha256')
    .update(signatureData)
    .digest('hex')
    .padEnd(130, '0'); // Pad to 130 chars (65 bytes)
  
  log('TEE approval signature generated', 'success');
  return signature;
}
