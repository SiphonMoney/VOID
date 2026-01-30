// Mock TEE Server
// Simulates Intel SGX TEE hardware for AnonyMaus
// In production, this would run on actual TEE-enabled hardware

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import bs58 from 'bs58';
import dotenv from 'dotenv';

// Import modular functions
import { validateIntentExpiryAndNonce, processIntent, generateTEESignature, validateIncoHandles } from './modules/intent.js';
import { submitSolanaTransaction, waitForTransactionConfirmation } from './modules/transaction.js';
import { initializeTEEKeyPair, getTEEPublicKey, decryptIntent, getTEEAttestation } from './modules/tee.js';
import { verifySolanaSignature } from './modules/signature.js';
import { log, getLogs, logIntentDetails, logTransactionDetails, logPDADetails, logAccountStatus } from './modules/logger.js';
// Pool discovery removed - using hardcoded pool ID
import { executeSwap, transferSwapOutput } from './modules/swap-executor.js';
import { initializePERConnection, getPERInfo } from './modules/magicblock.js';
import { encryptValue } from '@inco/solana-sdk/encryption';

// Get current directory (ES modules don't have __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server directory
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

// Debug: Log if .env file was found and if EXECUTION_ACCOUNT_PRIVATE_KEY is loaded
if (fs.existsSync(envPath)) {
  console.log(`✅ [TEE Server] .env file found at: ${envPath}`);
  if (process.env.EXECUTION_ACCOUNT_PRIVATE_KEY) {
    console.log(`✅ [TEE Server] EXECUTION_ACCOUNT_PRIVATE_KEY loaded (length: ${process.env.EXECUTION_ACCOUNT_PRIVATE_KEY.length} chars)`);
  } else {
    console.warn(`⚠️  [TEE Server] EXECUTION_ACCOUNT_PRIVATE_KEY not found in .env file`);
  }
} else {
  console.warn(`⚠️  [TEE Server] .env file not found at: ${envPath}`);
}

const app = express();
const PORT = process.env.PORT || 3001;
const INCO_LIGHTNING_PROGRAM_ID =
  process.env.INCO_LIGHTNING_PROGRAM_ID || '5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj';

// Enable CORS for extension
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function getExplorerUrl(signature, rpcUrl) {
  if (!signature) return null;
  let cluster = 'devnet';
  const url = (rpcUrl || '').toLowerCase();
  if (url.includes('mainnet') || url.includes('mainnet-beta')) {
    cluster = 'mainnet-beta';
  } else if (url.includes('testnet')) {
    cluster = 'testnet';
  }
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

function resolveRpcUrl({ strategy, customUrl, network }) {
  const normalized = (strategy || 'default').toLowerCase();
  const isValidCustom = typeof customUrl === 'string' && /^https?:\/\//i.test(customUrl);

  if (normalized === 'custom' && isValidCustom) {
    return customUrl;
  }

  const defaultDevnet =
    process.env.SOLANA_RPC_URL_DEVNET ||
    process.env.SOLANA_RPC_URL ||
    'https://solana-devnet.g.alchemy.com/v2/Sot3NTHhsx_C1Eunyg9ni';

  const publicDevnet =
    process.env.SOLANA_RPC_URL_PUBLIC ||
    'https://api.devnet.solana.com';

  if (normalized === 'public') {
    return publicDevnet;
  }

  if (normalized === 'alchemy') {
    return process.env.SOLANA_RPC_URL_ALCHEMY || defaultDevnet;
  }

  if (normalized === 'infura') {
    return process.env.SOLANA_RPC_URL_INFURA || defaultDevnet;
  }

  if (network === 'mainnet-beta' || network === 'mainnet') {
    return process.env.SOLANA_RPC_URL_MAINNET || 'https://api.mainnet-beta.solana.com';
  }

  if (network === 'testnet') {
    return process.env.SOLANA_RPC_URL_TESTNET || 'https://api.testnet.solana.com';
  }

  return defaultDevnet;
}


// Pool discovery functions moved to modules/pool-discovery.js

// Rate limiting for DoS protection
const rateLimitStore = new Map(); // IP -> { requests: [], lastCleanup: timestamp }
const RATE_LIMIT_WINDOW = 60000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 30; // Max requests per window per IP
const RATE_LIMIT_CLEANUP_INTERVAL = 300000; // Clean up old entries every 5 minutes

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    // Remove requests older than window
    data.requests = data.requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
    
    // Remove entry if no recent requests
    if (data.requests.length === 0 && now - data.lastCleanup > RATE_LIMIT_CLEANUP_INTERVAL) {
      rateLimitStore.delete(ip);
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL);

// Rate limiting middleware
function rateLimitMiddleware(req, res, next) {
  // Get client IP (consider X-Forwarded-For for proxies)
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress ||
                   'unknown';
  
  const now = Date.now();
  
  // Get or create rate limit entry
  if (!rateLimitStore.has(clientIP)) {
    rateLimitStore.set(clientIP, { requests: [], lastCleanup: now });
  }
  
  const entry = rateLimitStore.get(clientIP);
  
  // Remove old requests outside the window
  entry.requests = entry.requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  // Check if limit exceeded
  if (entry.requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestRequest = entry.requests[0];
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - oldestRequest)) / 1000);
    
    log(`🚫 Rate limit exceeded for IP ${clientIP}: ${entry.requests.length} requests in window`, 'warn');
    
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Too many requests. Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW / 1000} seconds.`,
      retryAfter: retryAfter
    });
  }
  
  // Add current request
  entry.requests.push(now);
  entry.lastCleanup = now;
  
  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.requests.length));
  res.setHeader('X-RateLimit-Reset', new Date(now + RATE_LIMIT_WINDOW).toISOString());
  
  next();
}

// Simulate TEE enclave state
const teeState = {
  enclaveId: 'sgx-enclave-' + crypto.randomBytes(8).toString('hex'),
  attestationKey: crypto.randomBytes(32).toString('hex'),
  isInitialized: true,
  processedIntents: new Map()
};

// Initialize TEE key pair on startup
const teeKeyPair = initializeTEEKeyPair(log);
if (!teeKeyPair) {
  log('⚠️  TEE key pair initialization failed - encryption may not work', 'error');
} else {
  const publicKeyInfo = getTEEPublicKey();
  teeState.publicKeyId = publicKeyInfo.keyPair ? crypto.createHash('sha256').update(publicKeyInfo.pem).digest('hex').substring(0, 16) : null;
}

// Initialize MagicBlock PER connection
const usePER = process.env.USE_MAGICBLOCK_PER === 'true';
if (usePER) {
  try {
    initializePERConnection(log);
    const perInfo = getPERInfo();
    log(`✅ MagicBlock PER enabled: ${perInfo.rpc}`, 'success');
    teeState.usePER = true;
    teeState.perInfo = perInfo;
  } catch (error) {
    log(`⚠️  MagicBlock PER initialization failed: ${error.message}`, 'warn');
    log('   Continuing with base layer execution', 'info');
    teeState.usePER = false;
  }
} else {
  log('ℹ️  MagicBlock PER disabled (set USE_MAGICBLOCK_PER=true to enable)', 'info');
  teeState.usePER = false;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    enclave: getTEEAttestation(teeState),
    uptime: process.uptime()
  });
});

// Get TEE public key endpoint (for client-side encryption)
app.get('/api/public-key', (req, res) => {
  try {
    const publicKeyInfo = getTEEPublicKey();
    
    if (!publicKeyInfo.jwk || !publicKeyInfo.pem) {
      return res.status(503).json({
        error: 'TEE public key not available',
        success: false
      });
    }
    
    // Return public key in both JWK (for Web Crypto API) and PEM formats
    const publicKeyId = crypto.createHash('sha256').update(publicKeyInfo.pem).digest('hex');
    
    res.json({
      success: true,
      publicKey: {
        jwk: publicKeyInfo.jwk, // For Web Crypto API
        pem: publicKeyInfo.pem,  // For reference/verification
        format: 'RSA-OAEP',
        keySize: 2048,
        keyId: publicKeyId.substring(0, 16), // Short ID for reference
        algorithm: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      enclaveId: teeState.enclaveId,
      timestamp: Date.now()
    });
  } catch (error) {
    log(`Error serving public key: ${error.message}`, 'error');
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Inco encryption endpoint (dev-only proxy)
app.post('/api/inco-encrypt', rateLimitMiddleware, async (req, res) => {
  try {
    const { values } = req.body || {};

    if (!values || typeof values !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Missing values object in request body'
      });
    }

    const handles = {};
    const handleFormat = 'sha256';

    const parseValue = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
          throw new Error('Floating point values are not supported');
        }
        return value;
      }
      if (typeof value === 'string') {
        if (/^\d+$/.test(value)) {
          return BigInt(value);
        }
        return null;
      }
      return null;
    };

    for (const [key, rawValue] of Object.entries(values)) {
      const parsed = parseValue(rawValue);
      if (parsed === null) {
        continue;
      }

      const ciphertext = await encryptValue(parsed);
      const hash = crypto.createHash('sha256').update(ciphertext).digest('hex');

      handles[key] = {
        ciphertext,
        hash,
        bytes: ciphertext.length / 2
      };
    }

    res.json({
      success: true,
      handleFormat,
      handles
    });
  } catch (error) {
    log(`Inco encryption failed: ${error.message}`, 'error');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Main TEE approval endpoint (with rate limiting)
app.post('/api/approve', rateLimitMiddleware, async (req, res) => {
  try {
    const { encryptedIntent, intent: signedIntent } = req.body;
    
    if (!signedIntent && !encryptedIntent) {
      return res.status(400).json({
        error: 'Missing intent or encryptedIntent in request body'
      });
    }
    
    // Step 1: Decrypt intent inside TEE
    const intent = signedIntent ? signedIntent : await decryptIntent(encryptedIntent, log);
    logIntentDetails(intent, log);

    // Step 1.1: Validate Inco handles (no plaintext privacy fields)
    validateIncoHandles(intent, log);
    
    // Step 2: Validate intent expiry and nonce (replay protection)
    try {
      validateIntentExpiryAndNonce(intent, teeState.processedIntents, log);
    } catch (error) {
      return res.status(400).json({
        error: error.message || 'Intent validation failed',
        approved: false
      });
    }
    
    // Step 3: Verify user signature cryptographically (Solana Ed25519)
    // Allow skipping signature verification for testing (set SKIP_SIGNATURE_VERIFICATION=true in .env)
    const skipVerification = process.env.SKIP_SIGNATURE_VERIFICATION === 'true';
    
    let signatureValid = false;
    if (skipVerification) {
      log(`⚠️  SKIP_SIGNATURE_VERIFICATION is enabled - skipping signature verification`, 'warn');
      signatureValid = true;
    } else {
      // For Solana, verify Ed25519 signature on intent hash
      signatureValid = verifySolanaSignature(intent, {}, log);
    }
    
    if (!signatureValid) {
      return res.status(401).json({
        error: 'Invalid user signature',
        approved: false
      });
    }
    
    // Step 4: Process intent (route finding, pricing, etc.)
    const executionPlan = processIntent(intent, log);
    
    // Step 5: Generate TEE approval signature
    const teeSignature = generateTEESignature(intent, executionPlan, teeState, log);
    
    // Step 6: Store processed intent (for tracking and replay protection)
    teeState.processedIntents.set(intent.intentHash, {
      intent,
      executionPlan,
      teeSignature,
      processedAt: Date.now(),
      status: 'approved' // Mark as approved so execution endpoint can process it
    });
    
    // Return TEE approval
    const approval = {
      approved: true,
      signature: teeSignature,
      executionPlan,
      enclaveId: teeState.enclaveId,
      attestation: getTEEAttestation(teeState),
      timestamp: Date.now()
    };
    
    log(`Intent approved: ${intent.action}`, 'success');
    
    res.json(approval);
    
  } catch (error) {
    log(`TEE approval failed: ${error.message}`, 'error');
    res.status(500).json({
      error: error.message,
      approved: false
    });
  }
});

// Get processed intent status
app.get('/api/intent/:intentHash', (req, res) => {
  const { intentHash } = req.params;
  const processed = teeState.processedIntents.get(intentHash);
  
  if (!processed) {
    return res.status(404).json({
      error: 'Intent not found'
    });
  }
  
  res.json({
    intentHash,
    processedAt: processed.processedAt,
    executionPlan: processed.executionPlan,
    status: 'processed'
  });
});

// Get TEE status
app.get('/api/status', (req, res) => {
  // Try to get executor address from deployment file first, then env
  // Get Solana executor program ID (deployed program address)
  // Check both SOLANA_EXECUTOR_PROGRAM_ID (preferred) and SOLANA_EXECUTOR_PUBLIC_KEY (legacy)
  const executorPublicKey = process.env.SOLANA_EXECUTOR_PROGRAM_ID || 
                            process.env.SOLANA_EXECUTOR_PUBLIC_KEY || 
                            '11111111111111111111111111111111';
  
  try {
    const status = {
      status: 'operational',
      enclave: getTEEAttestation(teeState),
      processedIntents: teeState.processedIntents.size,
      uptime: process.uptime(),
      executorPublicKey: executorPublicKey, // Solana executor program public key
    };
    
    // Add PER info if enabled
    if (teeState.usePER && teeState.perInfo) {
      status.magicblock = {
        enabled: true,
        ...teeState.perInfo,
      };
    } else {
      status.magicblock = {
        enabled: false,
      };
    }
    
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      status: 'error'
    });
  }
});

// Ethereum-only endpoints removed - this is Solana-only version

// RPC endpoints - Solana only
// API endpoint to get RPC URL (for extension to use)
app.get('/api/rpc-url', (req, res) => {
  const network = req.query.network || 'devnet';
  const strategy = req.query.strategy || 'default';
  const custom = req.query.custom || null;

  const rpcUrl = resolveRpcUrl({
    strategy,
    customUrl: custom,
    network,
  });
  
  res.json({ 
    success: true, 
    rpcUrl,
    network,
    strategy
  });
});


// API endpoint to get server logs (for extension console viewer)
app.get('/api/server-logs', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const filteredLogs = getLogs(since);
  res.json({
    success: true,
    logs: filteredLogs,
    count: filteredLogs.length
  });
});

// Ethereum-only functions removed - this is Solana-only version

// Submit Solana transaction (with rate limiting)
app.post('/api/submit-solana-transaction', rateLimitMiddleware, async (req, res) => {
  try {
    const { encryptedIntent, intent: signedIntent, transactionData, method, rpcSelector, customRpcUrl } = req.body;

    log(`🔔 Submit request received (${method || 'unknown'})`, 'info');
    
    if (!signedIntent && !encryptedIntent) {
      return res.status(400).json({
        error: 'Missing intent or encryptedIntent in request body',
        success: false
      });
    }
    
    if (!transactionData) {
      return res.status(400).json({
        error: 'Missing transactionData in request body',
        success: false
      });
    }
    
    // Step 1: Decrypt intent inside TEE
    const intent = signedIntent ? signedIntent : await decryptIntent(encryptedIntent, log);
    logIntentDetails(intent, log);

    // Step 1.1: Validate Inco handles (no plaintext privacy fields)
    validateIncoHandles(intent, log);
    
    // Step 2: Validate intent expiry and nonce (replay protection)
    // Allow already-approved intents to be executed
    try {
      validateIntentExpiryAndNonce(intent, teeState.processedIntents, log, true); // allowAlreadyApproved = true for execution
    } catch (error) {
      return res.status(400).json({
        error: error.message || 'Intent validation failed',
        success: false
      });
    }
    
    // Step 3: Verify user signature cryptographically
    // For Solana, signature verification is different - we verify the signed transaction
    const signatureValid = verifySolanaSignature(intent, transactionData, log);
    if (!signatureValid) {
      return res.status(401).json({
        error: 'Invalid user signature',
        success: false
      });
    }
    
    // Step 4: Process intent
    const executionPlan = processIntent(intent, log);
    
    // Step 5: Execute Solana transaction via executor program
    const rpcUrl = resolveRpcUrl({
      strategy: rpcSelector,
      customUrl: customRpcUrl,
      network: process.env.SOLANA_NETWORK || 'devnet',
    });
    if (rpcSelector) {
      log(`🌐 [TEE Server] RPC strategy: ${rpcSelector}`, 'info');
    }
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Get execution keypair from environment
    const executionSecretKey = process.env.SOLANA_EXECUTION_SECRET_KEY || process.env.SOLANA_WALLET_SECRET_KEY;
    if (!executionSecretKey) {
      throw new Error('SOLANA_EXECUTION_SECRET_KEY or SOLANA_WALLET_SECRET_KEY not set in .env file');
    }
    
    let executionKeypair;
    try {
      const secretKeyBytes = bs58.decode(executionSecretKey);
      executionKeypair = Keypair.fromSecretKey(secretKeyBytes);
    } catch (e) {
      try {
        const secretKeyArray = JSON.parse(executionSecretKey);
        executionKeypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
      } catch (e2) {
        throw new Error('Invalid SOLANA_EXECUTION_SECRET_KEY format. Use base58 or JSON array.');
      }
    }
    
    const executorProgramId = process.env.SOLANA_EXECUTOR_PROGRAM_ID || 'AnonyMausExecutor111111111111111111111111';
    const executorProgramPubkey = new PublicKey(executorProgramId);
    
    logTransactionDetails(transactionData, intent, executorProgramId, executionKeypair.publicKey.toString(), log);
    
    // Build intent hash (32 bytes)
    const intentHashHex = intent.intentHash?.replace('0x', '') || '';
    if (intentHashHex.length !== 64) {
      throw new Error('Invalid intent hash length');
    }
    const intentHashBytes = Buffer.from(intentHashHex, 'hex');
    const intentHash32 = new Uint8Array(intentHashBytes);
    
    // Get user public key
    const userPubkey = new PublicKey(intent.signer);
    
    // Derive PDAs
    const [executorPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('executor')],
      executorProgramPubkey
    );
    
    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      executorProgramPubkey
    );
    
    const [userDepositPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_deposit'), userPubkey.toBuffer()],
      executorProgramPubkey
    );
    
    logPDADetails({ executorPDA, vaultPDA, userDepositPDA }, log);
    
    // Check if accounts exist and are initialized
    const executorAccountInfo = await connection.getAccountInfo(executorPDA);
    const userDepositAccountInfo = await connection.getAccountInfo(userDepositPDA);
    const vaultAccountInfo = await connection.getAccountInfo(vaultPDA);
    
    if (!executorAccountInfo) {
      const executionPubkey = executionKeypair.publicKey.toString();
      throw new Error(`Executor PDA account not found. Please initialize the executor program first by running: npm run initialize-solana-program ${executionPubkey}`);
    }
    
    if (!userDepositAccountInfo) {
      // Return proper error response similar to ETH version
      return res.status(400).json({
        error: 'User deposit account not found',
        message: 'User needs to deposit funds to the executor program before executing transactions.',
        userAddress: userPubkey.toString(),
        executorProgramId: executorProgramId,
        userDepositPDA: userDepositPDA.toString(),
        vaultPDA: vaultPDA.toString(),
        needsDeposit: true,
        success: false
      });
    }
    
    logAccountStatus({
      executor: !!executorAccountInfo,
      userDeposit: !!userDepositAccountInfo,
      vault: vaultAccountInfo ? true : (vaultAccountInfo === null ? false : undefined)
    }, log);
    
    // Build swap transaction on TEE (Raydium devnet)
    const swapParams = transactionData.swapParams || intent.metadata?.swapParams || {};
    const inputMintRaw = swapParams.inputMint;
    const outputMintRaw = swapParams.outputMint;
    
    // Debug logging for amount extraction
    log(`🔍 [TEE Server] Amount extraction debug:`, 'info');
    log(`   swapParams.amountInLamports: ${swapParams.amountInLamports} (type: ${typeof swapParams.amountInLamports})`, 'info');
    log(`   transactionData.extractedAmountLamports: ${transactionData.extractedAmountLamports} (type: ${typeof transactionData.extractedAmountLamports})`, 'info');
    log(`   swapParams: ${JSON.stringify(swapParams)}`, 'info');
    
    const amountInLamports = BigInt(swapParams.amountInLamports || transactionData.extractedAmountLamports || 0);
    const incoEnforced = !!intent?.inco?.handles?.amountLamports?.ciphertext;
    const feeBufferLamports = incoEnforced ? 0n : 50000n;
    const fundAmountLamports = amountInLamports + feeBufferLamports;
    const slippage = typeof swapParams.slippage === 'number'
      ? swapParams.slippage
      : parseFloat(intent.limits?.maxSlippage || '0.01');

    log(`🔍 [TEE Server] Calculated amountInLamports: ${amountInLamports.toString()}`, 'info');

    if (!inputMintRaw || !outputMintRaw) {
      throw new Error('Missing swap params (inputMint/outputMint)');
    }
    if (amountInLamports <= 0n) {
      log(`❌ [TEE Server] Invalid amount: ${amountInLamports.toString()}, swapParams: ${JSON.stringify(swapParams)}, extractedAmountLamports: ${transactionData.extractedAmountLamports}`, 'error');
      throw new Error(`Missing or invalid swap amount. Got: ${amountInLamports.toString()}, swapParams.amountInLamports: ${swapParams.amountInLamports}, transactionData.extractedAmountLamports: ${transactionData.extractedAmountLamports}`);
    }


    const mintIn = inputMintRaw.toLowerCase() === 'sol'
      ? NATIVE_MINT
      : new PublicKey(inputMintRaw);
    const mintOut = outputMintRaw.toLowerCase() === 'sol'
      ? NATIVE_MINT
      : new PublicKey(outputMintRaw);
    
    // Use hardcoded pool ID for devnet (SOL/zUSDC pool)
    if (!swapParams.poolId) {
      swapParams.poolId = 'DKgK88CMJbQDpPWhhkN6j1sMVnXJJvuScubeTBKKNdwL';
      log(`✅ Using hardcoded pool ID: ${swapParams.poolId}`, 'info');
    }

    // 1) Move funds from vault to execution account (authorized by intent)
    const signatureHex = intent.signature?.replace('0x', '') || '';
    const signatureBytes = Buffer.from(signatureHex, 'hex');
    const EXECUTE_WITH_INTENT = 3;
    const amountHandle = intent?.inco?.handles?.amountLamports;
    if (!amountHandle?.ciphertext) {
      throw new Error('Missing Inco amount ciphertext for swap enforcement');
    }
    const amountCiphertext = Buffer.from(amountHandle.ciphertext, 'hex');
    const ciphertextLen = Buffer.alloc(4);
    ciphertextLen.writeUInt32LE(amountCiphertext.length, 0);
    const inputType = Buffer.from([0]);

    const instructionData = Buffer.concat([
      Buffer.alloc(1 + 32 + 4 + signatureBytes.length + 8),
      ciphertextLen,
      amountCiphertext,
      inputType
    ]);
    instructionData[0] = EXECUTE_WITH_INTENT;
    intentHash32.forEach((byte, i) => {
      instructionData[1 + i] = byte;
    });
    instructionData.writeUInt32LE(signatureBytes.length, 33);
    signatureBytes.copy(instructionData, 37);
    instructionData.writeBigUInt64LE(fundAmountLamports, 37 + signatureBytes.length);

    const incoProgramPubkey = new PublicKey(INCO_LIGHTNING_PROGRAM_ID);
    const instructionKeys = [
      { pubkey: executorPDA, isSigner: false, isWritable: false },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: userDepositPDA, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: false, isWritable: false },
      { pubkey: executionKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: incoProgramPubkey, isSigner: false, isWritable: false }
    ];

    const fundTx = new Transaction();
    const { blockhash: fundBlockhash } = await connection.getLatestBlockhash('confirmed');
    fundTx.recentBlockhash = fundBlockhash;
    fundTx.feePayer = executionKeypair.publicKey;
    fundTx.add({
      keys: instructionKeys,
      programId: executorProgramPubkey,
      data: instructionData
    });
    fundTx.sign(executionKeypair);
    const fundSig = await connection.sendRawTransaction(fundTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });
    log(`✅ Funding transaction submitted: ${fundSig}`, 'success');

    // 2) Execute swap using swap executor module (always on L1, not PER)
    // Hybrid flow: PER for custody/auth, but swaps execute on base layer
    // This avoids PER delegation issues with Raydium pools
    log('🔄 Executing swap on base layer (L1) - hybrid flow', 'info');
    log(`🔍 [TEE Server] Swap params: amountIn=${amountInLamports.toString()}, mintIn=${mintIn.toString()}, mintOut=${mintOut.toString()}, slippage=${slippage}`, 'info');
    try {
      const swapResult = await executeSwap({
        connection,
        executionKeypair,
        mintIn,
        mintOut,
        amountIn: amountInLamports,
        slippage,
        poolId: swapParams.poolId,
        userPubkey,
        transactionData,
        usePER: false, //  execute swaps on L1 (base layer), not PER
      });

      // 3) Transfer output to user
      await transferSwapOutput({
        connection,
        executionKeypair,
        mintOut,
        outAta: swapResult.outAta,
        userPubkey,
      });

      // Use swap signature for response
      const swapSignature = swapResult.signature;
    
      // Store processed intent as submitted immediately
      teeState.processedIntents.set(intent.intentHash, {
        intent,
        executionPlan,
        processedAt: Date.now(),
        chain: 'solana',
        signature: swapSignature,
        status: 'submitted'
      });

      // Respond immediately with signature to avoid dApp timeouts
      const explorerUrl = getExplorerUrl(swapSignature, rpcUrl);
      res.json({
        success: true,
        signature: swapSignature,
        explorerUrl,
        status: 'submitted',
        timestamp: Date.now()
      });

      // Note: Confirmation is already handled in swap-executor.js
      // This async confirmation is just for updating state, not blocking
      waitForTransactionConfirmation(swapSignature, rpcUrl, log, 60000)
        .then((confirmation) => {
          if (confirmation?.err) {
            log(`❌ Transaction failed (async check): ${JSON.stringify(confirmation.err)}`, 'error');
            return;
          }
          teeState.processedIntents.set(intent.intentHash, {
            intent,
            executionPlan,
            processedAt: Date.now(),
            chain: 'solana',
            signature: swapSignature,
            status: 'executed'
          });
          log(`✅ Transaction confirmed (async check): ${swapSignature}`, 'success');
        })
        .catch((confirmError) => {
          // Don't log as error - confirmation in swap-executor.js already handled it
          log(`ℹ️ Async confirmation check completed: ${confirmError.message}`, 'info');
        });
    } catch (swapError) {
      log(`❌ [TEE Server] Swap execution error: ${swapError.message}`, 'error');
      log(`❌ [TEE Server] Error stack: ${swapError.stack}`, 'error');
      if (swapError.message && swapError.message.includes('53 bits')) {
        log(`❌ [TEE Server] Number overflow error detected. This usually happens when Raydium SDK processes large pool reserves.`, 'error');
      }
      throw swapError;
    }
    
  } catch (error) {
    log(`❌ [TEE Server] Transaction submission failed: ${error.message}`, 'error');
    log(`❌ [TEE Server] Error stack: ${error.stack}`, 'error');
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// verifySolanaSignature moved to modules/signature.js

// Start server
app.listen(PORT, () => {
  const publicKeyInfo = getTEEPublicKey();
  const perStatus = teeState.usePER ? '✅ PER Enabled' : '❌ PER Disabled';
  log(`🚀 TEE Server started on port ${PORT} | Enclave: ${teeState.enclaveId} | TEE Key: ${publicKeyInfo.jwk ? 'Available' : 'NOT AVAILABLE'} | ${perStatus} | Executor: ${process.env.SOLANA_EXECUTOR_PROGRAM_ID || process.env.SOLANA_EXECUTOR_PUBLIC_KEY || 'NOT SET'}`, 'success');
});

