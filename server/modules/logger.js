// Logging module
// Handles server logging, log storage, and log retrieval

const serverLogs = [];
const MAX_SERVER_LOGS = 500;

/**
 * Enhanced logging function that stores logs in memory
 * @param {string} message - Log message
 * @param {string} type - Log type: 'info', 'success', 'error', 'warn'
 */
export function log(message, type = 'info') {
  const timestamp = Date.now();
  const logEntry = {
    message: String(message),
    type: type,
    source: 'server',
    timestamp: timestamp
  };
  
  // Store in memory
  serverLogs.push(logEntry);
  if (serverLogs.length > MAX_SERVER_LOGS) {
    serverLogs.shift(); // Remove oldest
  }
  
  // Also log to console
  const timestampISO = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warn' ? '⚠️' : '🔐';
  console.log(`[${timestampISO}] ${prefix} [TEE Server] ${message}`);
}

/**
 * Get server logs filtered by timestamp
 * @param {number} since - Timestamp to filter logs (only return logs after this)
 * @returns {Array} Filtered log entries
 */
export function getLogs(since = 0) {
  return serverLogs.filter(log => log.timestamp > since);
}

/**
 * Get all server logs
 * @returns {Array} All log entries
 */
export function getAllLogs() {
  return serverLogs;
}

/**
 * Clear all server logs
 */
export function clearLogs() {
  serverLogs.length = 0;
}

/**
 * Get log count
 * @returns {number} Number of stored logs
 */
export function getLogCount() {
  return serverLogs.length;
}

/**
 * Log intent details in a structured way
 * @param {Object} intent - The intent object
 * @param {Function} logFn - The log function to use
 */
export function logIntentDetails(intent, logFn = log) {
  logFn(`Decrypted intent: ${intent.action} from ${intent.signer}`, 'info');
  if (intent.intentHash) {
    logFn(`Intent hash: ${intent.intentHash.substring(0, 20)}...`, 'info');
  }
}

/**
 * Log transaction details in a structured way
 * @param {Object} transactionData - Transaction data
 * @param {Object} intent - Intent object
 * @param {string} executorProgramId - Executor program ID
 * @param {string} executionAccount - Execution account public key
 * @param {Function} logFn - The log function to use
 */
export function logTransactionDetails(transactionData, intent, executorProgramId, executionAccount, logFn = log) {
  logFn(`📋 Transaction: ${transactionData.instructions?.length || 0} instructions, User: ${intent.signer}, Executor: ${executorProgramId}`, 'info');
}

/**
 * Log PDA details in a structured way
 * @param {Object} pdas - Object with executorPDA, vaultPDA, userDepositPDA
 * @param {Function} logFn - The log function to use
 */
export function logPDADetails(pdas, logFn = log) {
  logFn(`PDAs - Executor: ${pdas.executorPDA}, Vault: ${pdas.vaultPDA}, User Deposit: ${pdas.userDepositPDA}`, 'info');
}

/**
 * Log account initialization status
 * @param {Object} status - Status object with executor, userDeposit, vault
 * @param {Function} logFn - The log function to use
 */
export function logAccountStatus(status, logFn = log) {
  if (status.executor) {
    logFn(`✅ Executor PDA exists`, 'success');
  } else {
    logFn(`❌ Executor PDA not found: ${status.executorError || ''}`, 'error');
  }
  
  if (status.userDeposit) {
    logFn(`✅ User deposit account exists`, 'success');
  } else {
    logFn(`❌ User deposit account not found`, 'error');
  }
  
  if (status.vault) {
    logFn(`✅ Vault PDA exists`, 'success');
  } else if (status.vault !== undefined) {
    logFn(`⚠️  Vault PDA not found (will be created if needed)`, 'warn');
  }
}
