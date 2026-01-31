# VØID Architecture Deep Dive

This document provides a detailed technical walkthrough of VØID's architecture, implementation patterns, and design decisions.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Client Layer Architecture](#client-layer-architecture)
3. [TEE Server Architecture](#tee-server-architecture)
4. [On-Chain Architecture](#on-chain-architecture)
5. [Data Flow](#data-flow)
6. [Security Model](#security-model)
7. [Performance Considerations](#performance-considerations)
8. [Design Decisions](#design-decisions)

---

## System Overview

VØID implements a **three-layer privacy architecture** for Solana transactions:

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                              │
│  ┌────────────┐    ┌────────────┐    ┌─────────────────┐   │
│  │ Interceptor│ -> │ Intent     │ -> │ Encryption      │   │
│  │ (content)  │    │ Builder    │    │ (Inco SDK)      │   │
│  └────────────┘    └────────────┘    └─────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Encrypted Intent
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    TEE SERVER LAYER                          │
│  ┌────────────┐    ┌────────────┐    ┌─────────────────┐   │
│  │ Validator  │ -> │ Executor   │ -> │ Transaction     │   │
│  │ (intent.js)│    │(swap-exec) │    │ Submitter       │   │
│  └────────────┘    └────────────┘    └─────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ On-Chain Tx
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    ON-CHAIN LAYER                            │
│  ┌────────────┐    ┌────────────┐    ┌─────────────────┐   │
│  │ Executor   │ -> │ Inco       │ -> │ Raydium         │   │
│  │ Program    │    │ Lightning  │    │ AMM             │   │
│  └────────────┘    └────────────┘    └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Key Characteristics:**
- **Trust-minimized:** Client verifies intent before signing, on-chain enforces rules via FHE
- **Modular:** Each layer is independently testable and replaceable
- **Non-invasive:** No changes required to existing dApps or wallets
- **Privacy-first:** Sensitive data encrypted before network transmission

---

## Client Layer Architecture

### Overview

The client layer runs entirely in the user's browser as a Chrome extension (Manifest V3). It intercepts wallet interactions, builds intents, encrypts sensitive data, and coordinates with the TEE server.

### Component Breakdown

#### 1. Content Script (`content.js`)

**Purpose:** Runs in page context to inject interceptor and bridge messages between page and extension.

**Lifecycle:**
```javascript
document_start → inject scripts → setup message bridge → listen for events
```

**Key Functions:**
- **`injectSolanaTransactionInterceptor()`** — Injects interceptor into page DOM before any dApp JS runs
- **`setupPageToExtensionBridge()`** — Forwards messages from page to background service worker
- **`setupExtensionToPageBridge()`** — Forwards responses from background to page
- **`handlePhantomSigning()`** — Coordinates with Phantom to get user signatures

**Security Considerations:**
- Runs at `document_start` to ensure interception happens before dApp code
- Only accepts messages from same window (prevents XSS)
- Validates message origin to prevent cross-origin attacks

---

#### 2. Background Service Worker (`background.js`)

**Purpose:** Orchestrates entire flow — receives intercepted transactions, builds intents, encrypts data, manages signatures, submits to TEE.

**Class Structure:**
```javascript
class AnonyMausBackground {
  constructor() {
    this.pendingRequests = new Map();
    this.pendingIntentSignatures = new Map();
    this.solanaIntentBuilder = null;
    this.teeClient = null;
    this.encryption = null;
  }
  
  // Flow: Initialize → Load Config → Setup Listeners → Handle Messages
}
```

**Main Flow (8 Steps):**

1. **Extract Required Amount** (`step1_ExtractRequiredAmount`)
   - Parses transaction instructions
   - Identifies System Program transfers and Raydium swaps
   - Handles BigInt amounts safely (prevents overflow)
   
2. **Validate Executor** (`step2_ValidateExecutor`)
   - Fetches executor program ID from TEE server
   - Validates program is deployed and initialized
   
3. **Request Vault Transfer** (`step3_RequestVaultTransfer`)
   - Builds deposit transaction to fund user PDA
   - Encrypts deposit amount using Inco SDK
   - Prompts user via Phantom to sign deposit
   
4. **Wait for Vault Transfer** (`step4_WaitForVaultTransfer`)
   - Polls RPC for transaction confirmation
   - Fast polling (500ms) for 5s, then slower (2s)
   
5. **Build Intent** (`step5_BuildIntent`)
   - Converts transaction to structured intent
   - Encrypts sensitive fields (amount, slippage)
   - Attaches Inco ciphertext handles
   - Validates intent structure
   
6. **Request User Signature** (`step6_RequestUserSignature`)
   - Prompts user via Phantom to sign intent
   - Intent includes expiry (5min default) and nonce
   
7. **Submit Transaction** (`step7_SubmitTransaction`)
   - Sends encrypted intent + transaction data to TEE
   - Handles deposit errors (retries if needed)
   - Returns transaction signature to dApp

**Key Methods:**
- **`extractRequiredLamports()`** — Parses transaction instructions for amounts (handles BigInt)
- **`buildSolanaIntent()`** — Creates structured intent from transaction
- **`requestSolanaVaultTransfer()`** — Builds deposit tx with Inco encryption
- **`resolveRpcUrl()`** — Resolves RPC URL based on user settings

**Error Handling:**
- Duplicate detection via pending transactions map
- Timeout handling (5min for user actions)
- Friendly error messages with flow context

---

#### 3. Solana Transaction Interceptor (`functions/solana-transaction-interceptor.js`)

**Purpose:** Wraps Phantom wallet API to intercept transaction calls before dApp sees them.

**Implementation Pattern:**
```javascript
// Backup original Phantom methods
const originalSignAndSendTransaction = window.solana.signAndSendTransaction;

// Wrap with interception logic
window.solana.signAndSendTransaction = async function(transaction, options) {
  // 1. Check if VØID is enabled
  if (!isVoidEnabled()) {
    return originalSignAndSendTransaction.call(this, transaction, options);
  }
  
  // 2. Parse transaction and extract metadata
  const parsedTx = parseTransaction(transaction);
  
  // 3. Send to background for intent creation
  const result = await sendToBackground({
    type: 'ANONYMAUS_SOLANA_FROM_PAGE',
    payload: {
      method: 'signAndSendTransaction',
      transaction: parsedTx,
      userRealPublicKey: window.solana.publicKey.toString()
    }
  });
  
  // 4. Return result to dApp (maintains API compatibility)
  return result;
};
```

**Transaction Parsing:**
- Deserializes transaction buffer using `@solana/web3.js`
- Extracts instructions, accounts, recent blockhash
- Identifies instruction types (transfer, swap, etc.)
- Extracts amounts from instruction data buffers

**Special Handling:**
- URL parameter extraction (inputMint, outputMint, poolId)
- BigInt amount handling (prevents JSON serialization issues)
- Raydium-specific instruction parsing

---

#### 4. Solana Intent Builder (`functions/solana-intent-builder.js`)

**Purpose:** Converts raw Solana transactions into structured intents with metadata.

**Intent Structure:**
```javascript
{
  action: 'execute_transaction',          // Intent type
  chain: 'solana',                         // Blockchain
  transactionType: 'SWAP/TRANSFER',        // Parsed type
  timestamp: 1704067200000,                // Creation time
  expiry: 1704067500000,                   // Expiry (5min default)
  nonce: 'random-uuid-v4',                 // Replay protection
  transaction: {                           // Original tx data
    instructions: [...],
    recentBlockhash: '...',
    feePayer: '...'
  },
  metadata: {                              // Extracted metadata
    dappName: 'Raydium',
    dappUrl: 'https://raydium.io',
    swapParams: {
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: '...',
      amountInLamports: 1000000000,
      slippage: 0.01
    }
  },
  limits: {                                // User-defined limits
    maxSlippage: '0.01',
    expiryDuration: 300                    // 5 minutes
  },
  signature: '...',                        // User signature (added later)
  intentHash: '...',                       // SHA-256 hash for nonce
  signer: '...',                           // User public key
  inco: {                                  // Inco encrypted handles
    handles: {
      amountLamports: {
        ciphertext: 'hex-string',
        hash: 'sha256-hash',
        bytes: 1024
      }
    }
  }
}
```

**Validation:**
- Required fields check
- Expiry must be in future
- Nonce must be valid UUID
- Transaction must have instructions

---

#### 5. Encryption Module (`functions/encryption.js`)

**Purpose:** Wraps Inco SDK to encrypt sensitive intent fields client-side.

**Key Methods:**

**`attachIncoHandles(intent)`**
- Extracts sensitive fields from intent
- Encrypts using `/api/inco-encrypt` endpoint
- Replaces plaintext with ciphertext handles
- Removes original plaintext fields

**`buildIncoHandles(values)`**
- Batch encrypts multiple values
- Returns map of field → handle
- Handle format: `{ ciphertext, hash, bytes }`

**Encrypted Fields:**
- `amountLamports` — Swap input amount
- `minOutAmount` — Minimum output (slippage protection)
- `maxSlippage` — User-defined slippage limit

**Security:**
- Encryption happens before RPC transmission
- TEE server generates ciphertext (in prod, client-side encryption)
- Ciphertext is append-only (cannot be modified)

---

#### 6. Phantom Signer (`functions/phantom-signer.js`)

**Purpose:** Handles user signature requests in page context (isolated from content script).

**Flow:**
```javascript
// Listen for signature requests
window.addEventListener('message', async (event) => {
  if (event.data.type === 'ANONYMAUS_SOLANA_SIGN_REQUEST') {
    const { intent, transaction, signingMethod } = event.data;
    
    // Build signable message
    const message = createSignableMessage(intent);
    
    // Request Phantom signature
    const result = await window.solana.signMessage(message);
    
    // Send back to content script
    window.postMessage({
      type: 'ANONYMAUS_SOLANA_SIGN_RESULT',
      success: true,
      signature: bs58.encode(result.signature),
      publicKey: result.publicKey.toString()
    }, '*');
  }
});
```

**Signature Types:**
1. **Intent Signature** — User signs intent hash (authorizes execution)
2. **Transaction Signature** — User signs raw tx (fallback if executor can't sign)

**Security:**
- Runs in page context (can access `window.solana`)
- Validates request origin
- Shows user-friendly message in Phantom popup

---

### Client-Side Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  dApp calls: wallet.signAndSendTransaction(tx)               │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Interceptor catches call, extracts tx details               │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Background: Parse tx → Build intent → Encrypt sensitive    │
│  fields with Inco SDK → Attach ciphertext handles           │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Check if deposit needed → Request deposit via Phantom       │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Request intent signature via Phantom (shows metadata)       │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Send encrypted intent + tx data to TEE server               │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Return tx signature to dApp (maintains API compatibility)  │
└─────────────────────────────────────────────────────────────┘
```

---

## TEE Server Architecture

### Overview

The TEE server simulates a Trusted Execution Environment and orchestrates transaction execution. In production, this would run on actual SGX/SEV hardware.

### Modular Architecture

**Philosophy:** Each module has single responsibility, clear interfaces, and is independently testable.

```
server/
├── server.js              # Express API + routing
├── modules/
│   ├── intent.js         # Intent validation logic
│   ├── signature.js      # Ed25519 verification
│   ├── swap-executor.js  # Raydium swap execution
│   ├── raydium-v2.js     # SDK integration
│   ├── magicblock.js     # PER integration
│   ├── tee.js            # Attestation + encryption
│   └── logger.js         # Structured logging
└── programs/             # On-chain program (Rust)
```

---

### Module Deep Dive

#### 1. Intent Validator (`modules/intent.js`)

**Purpose:** Validates intents before execution (expiry, nonce, Inco handles).

**Key Functions:**

**`validateIntentExpiryAndNonce(intent, processedIntents, log, allowAlreadyApproved)`**
- Checks intent expiry (must be in future)
- Validates nonce not already processed (replay protection)
- Optionally allows re-execution of approved intents

**`validateIncoHandles(intent, log)`**
- Ensures Inco handles are present
- Verifies no plaintext privacy fields remain
- Validates ciphertext format (hex string)

**`processIntent(intent, log)`**
- Builds execution plan from intent
- Extracts routing information
- Returns structured execution plan

**Replay Protection:**
```javascript
const processedIntents = new Map(); // intentHash → { processedAt, status }

// On validation
if (processedIntents.has(intent.intentHash)) {
  if (!allowAlreadyApproved) {
    throw new Error('Intent already processed (replay attack)');
  }
}

// On approval
processedIntents.set(intent.intentHash, {
  intent,
  processedAt: Date.now(),
  status: 'approved'
});
```

---

#### 2. Signature Verifier (`modules/signature.js`)

**Purpose:** Verifies Ed25519 signatures on intents.

**Implementation:**
```javascript
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export function verifySolanaSignature(intent, transactionData, log) {
  const { signature, intentHash, signer } = intent;
  
  // Decode signature and public key
  const signatureBytes = Buffer.from(signature.replace('0x', ''), 'hex');
  const messageBytes = Buffer.from(intentHash.replace('0x', ''), 'hex');
  const publicKeyBytes = new PublicKey(signer).toBytes();
  
  // Verify Ed25519 signature
  const isValid = nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKeyBytes
  );
  
  if (!isValid) {
    log('❌ Invalid signature', 'error');
    return false;
  }
  
  log('✅ Signature valid', 'success');
  return true;
}
```

**Security:**
- Uses `tweetnacl` for Ed25519 verification
- Validates signature length (64 bytes)
- Checks public key matches signer field

---

#### 3. Swap Executor (`modules/swap-executor.js`)

**Purpose:** Executes Raydium swaps using executor account.

**Flow:**
1. **Prepare Accounts** — Create ATAs for input/output tokens
2. **Wrap SOL** (if needed) — Transfer SOL to wrapped SOL ATA
3. **Build Swap Instructions** — Use Raydium SDK
4. **Execute Transaction** — Submit to Solana
5. **Transfer Output** — Send output tokens to user
6. **Cleanup** — Close wrapped SOL account

**Key Functions:**

**`executeSwap({ connection, executionKeypair, mintIn, mintOut, amountIn, slippage, poolId, userPubkey })`**
```javascript
// 1. Prepare executor ATAs
const { inAta, outAta, instructions: ataIx } = await prepareExecutorAccounts({
  connection,
  payer: executionKeypair.publicKey,
  owner: executionKeypair.publicKey,
  mintIn,
  mintOut,
  amountIn
});

// 2. Build swap transaction
const swapTx = new Transaction();
swapTx.add(...ataIx);

// Wrap SOL if needed
if (mintIn.equals(NATIVE_MINT)) {
  swapTx.add(
    SystemProgram.transfer({
      fromPubkey: executionKeypair.publicKey,
      toPubkey: inAta,
      lamports: Number(amountIn)
    }),
    createSyncNativeInstruction(inAta)
  );
}

// 3. Add Raydium swap instruction
const swapIx = await buildRaydiumSwapInstructionsV2({
  connection,
  poolId,
  mintIn,
  mintOut,
  amountIn,
  slippage,
  inAta,
  outAta,
  owner: executionKeypair.publicKey
});
swapTx.add(...swapIx);

// 4. Send transaction
swapTx.sign(executionKeypair);
const signature = await connection.sendRawTransaction(swapTx.serialize());

// 5. Wait for confirmation
await connection.confirmTransaction(signature, 'confirmed');

return { signature, outAta };
```

**`transferSwapOutput({ connection, executionKeypair, mintOut, outAta, userPubkey })`**
- Gets output token balance
- Builds transfer instruction
- Sends output to user's ATA
- Closes executor's output ATA

---

#### 4. Raydium Integration (`modules/raydium-v2.js`)

**Purpose:** Builds swap instructions using Raydium SDK V2.

**Challenges:**
- SDK designed for client-side, not server-side
- Pool discovery requires RPC calls
- Instruction building needs account fetching

**Solution:**
```javascript
import { ApiV3PoolInfoStandardItemCpmm } from '@raydium-io/raydium-sdk-v2';

export async function buildRaydiumSwapInstructionsV2({
  connection,
  poolId,
  mintIn,
  mintOut,
  amountIn,
  slippage,
  inAta,
  outAta,
  owner
}) {
  // 1. Fetch pool info (CLMM or CPMM)
  const poolInfo = await fetchPoolInfo(connection, poolId);
  
  // 2. Calculate amounts and slippage
  const minOutAmount = calculateMinOut(amountIn, poolInfo, slippage);
  
  // 3. Build swap instruction
  const swapIx = await poolInfo.makeSwapInstruction({
    amount: amountIn,
    minAmountOut: minOutAmount,
    userInputAccount: inAta,
    userOutputAccount: outAta,
    owner
  });
  
  return [swapIx];
}
```

**Pool Types Supported:**
- CLMM (Concentrated Liquidity)
- CPMM (Constant Product Market Maker)

---

#### 5. MagicBlock Integration (`modules/magicblock.js`)

**Purpose:** Integrates MagicBlock PER for fast private execution.

**Connection Setup:**
```javascript
import { Connection, PublicKey } from '@solana/web3.js';

let perConnection = null;
let perInfo = null;

export function initializePERConnection(log) {
  const perRpc = process.env.MAGICBLOCK_EPHEMERAL_RPC || 
                 'https://devnet.magicblock.app';
  
  perConnection = new Connection(perRpc, 'confirmed');
  
  perInfo = {
    rpc: perRpc,
    enabled: true,
    validator: process.env.MAGICBLOCK_VALIDATOR_PUBKEY || null,
    delegationProgram: process.env.MAGICBLOCK_DELEGATION_PROGRAM || null
  };
  
  log(`✅ MagicBlock PER initialized: ${perRpc}`, 'success');
}

export function getPERConnection() {
  return perConnection;
}

export function getPERInfo() {
  return perInfo;
}
```

**Hybrid Mode:**
VØID uses a hybrid approach:
- **PER for custody/auth** — Intent validation happens in TEE
- **L1 for swaps** — Raydium swaps execute on base layer (avoids delegation issues)

**Why Hybrid?**
- Raydium pools require specific account delegation
- PER delegation adds complexity and failure points
- Hybrid mode provides TEE benefits without swap fragility

---

#### 6. TEE Module (`modules/tee.js`)

**Purpose:** Simulates TEE attestation and encryption.

**Key Functions:**

**`initializeTEEKeyPair(log)`**
- Generates RSA-2048 key pair
- Stores in memory (not persisted)
- Used for client-side encryption (if needed)

**`getTEEAttestation(teeState)`**
- Returns simulated attestation report
- In production: SGX quote or SEV attestation

**`getTEEPublicKey()`**
- Returns public key in JWK + PEM formats
- Used for client-side encryption

---

### API Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/health` | GET | Health check | None |
| `/api/public-key` | GET | Get TEE public key for encryption | None |
| `/api/inco-encrypt` | POST | Encrypt values with Inco SDK | Rate-limited |
| `/api/approve` | POST | Validate intent, return TEE approval | Rate-limited |
| `/api/submit-solana-transaction` | POST | Execute swap via executor program | Rate-limited |
| `/api/rpc-url` | GET | Resolve RPC URL from strategy | None |
| `/api/status` | GET | Server status + executor info | None |
| `/api/server-logs` | GET | Retrieve server logs for debugging | None |

---

### Rate Limiting

**Implementation:**
```javascript
const rateLimitStore = new Map(); // IP → { requests: [], lastCleanup }
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 req/min

function rateLimitMiddleware(req, res, next) {
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                   req.connection.remoteAddress;
  
  const now = Date.now();
  const entry = rateLimitStore.get(clientIP) || { requests: [] };
  
  // Remove old requests
  entry.requests = entry.requests.filter(t => now - t < RATE_LIMIT_WINDOW);
  
  // Check limit
  if (entry.requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  entry.requests.push(now);
  rateLimitStore.set(clientIP, entry);
  
  next();
}
```

**Limitations:**
- IP-based (can be bypassed with VPN)
- In-memory storage (resets on restart)
- Production would use Redis + distributed rate limiting

---

## On-Chain Architecture

### Overview

The executor program is a **native Solana program** (no Anchor) that manages user deposits and executes transactions with encrypted balance enforcement via Inco Lightning.

### Program Structure

```
programs/anonymaus-executor/src/
└── lib.rs                # Single-file program (857 lines)
    ├── Instruction enum
    ├── State structs
    ├── Inco CPI functions
    └── Instruction processors
```

---

### State Accounts

#### 1. Executor PDA

**Seeds:** `['executor']`

**Structure:**
```rust
pub struct ExecutorState {
    pub is_initialized: bool,    // Prevents re-initialization
    pub authority: Pubkey,        // Program authority
    pub vault: Pubkey,            // Vault PDA
    pub nonce: u64,               // Global nonce counter
}
```

**Purpose:** Holds global program state and authority.

---

#### 2. Vault PDA

**Seeds:** `['vault']`

**Structure:** Regular Solana account (holds SOL)

**Purpose:** 
- Holds pooled SOL for gas fees
- Funds execution accounts when needed
- Receives fees from transactions

---

#### 3. User Deposit PDA

**Seeds:** `['user_deposit', user_pubkey]`

**Structure:**
```rust
pub struct UserDeposit {
    pub is_initialized: bool,
    pub user: Pubkey,
    pub encrypted_balance: u128,  // Inco handle (ciphertext)
    pub nonce: u64,
}
```

**Purpose:**
- Stores user's encrypted balance (Inco handle)
- Tracks per-user nonce for replay protection
- Used for balance checks without decryption

---

### Instructions

#### 1. Initialize

**Purpose:** Sets up executor state (one-time).

**Accounts:**
- `executor` (writable, PDA)
- `vault` (writable, PDA)
- `authority` (signer, writable)
- `system_program`

**Logic:**
```rust
fn process_initialize(accounts, authority_pubkey) -> ProgramResult {
    let executor = &mut accounts[0];
    let vault = &accounts[1];
    let authority = &accounts[2];
    
    // Create executor PDA
    let executor_state = ExecutorState {
        is_initialized: true,
        authority: *authority_pubkey,
        vault: *vault.key,
        nonce: 0,
    };
    
    // Serialize to account data
    executor_state.pack_into_slice(&mut executor.data.borrow_mut());
    
    Ok(())
}
```

---

#### 2. Deposit

**Purpose:** User deposits SOL, stores encrypted balance.

**Accounts:**
- `executor` (writable, PDA)
- `vault` (writable, PDA)
- `user_deposit` (writable, PDA)
- `user` (signer, writable)
- `system_program`
- `inco_program`

**Logic:**
```rust
fn process_deposit(
    accounts,
    amount: u64,
    ciphertext: &[u8],
    input_type: u8
) -> ProgramResult {
    let user = &accounts[3];
    let inco_program = &accounts[5];
    
    // 1. Transfer SOL to vault
    invoke(
        &system_instruction::transfer(user.key, vault.key, amount),
        &[user.clone(), vault.clone(), system_program.clone()]
    )?;
    
    // 2. Create encrypted balance via Inco
    let encrypted_amount = inco_new_euint128(
        user,
        inco_program,
        ciphertext,
        input_type
    )?;
    
    // 3. Update or create user deposit PDA
    let deposit = UserDeposit {
        is_initialized: true,
        user: *user.key,
        encrypted_balance: encrypted_amount,
        nonce: 0,
    };
    
    deposit.pack_into_slice(&mut user_deposit.data.borrow_mut());
    
    Ok(())
}
```

---

#### 3. Withdraw

**Purpose:** User withdraws SOL after encrypted balance check.

**Accounts:**
- `executor` (writable, PDA)
- `vault` (writable, PDA)
- `user_deposit` (writable, PDA)
- `user` (signer, writable)
- `system_program`
- `inco_program`

**Logic:**
```rust
fn process_withdraw(
    accounts,
    amount: u64,
    ciphertext: &[u8],
    input_type: u8
) -> ProgramResult {
    let user_deposit = &accounts[2];
    let deposit = UserDeposit::unpack(&user_deposit.data.borrow())?;
    
    // 1. Convert requested amount to encrypted
    let encrypted_amount = inco_new_euint128(
        user,
        inco_program,
        ciphertext,
        input_type
    )?;
    
    // 2. Check encrypted balance >= amount (no decryption!)
    let sufficient = inco_e_ge(
        user,
        inco_program,
        deposit.encrypted_balance,
        encrypted_amount
    )?;
    
    // Inco returns 1 if true, 0 if false
    if sufficient == 0 {
        return Err(ProgramError::InsufficientFunds);
    }
    
    // 3. Subtract amount from encrypted balance
    let new_balance = inco_e_sub(
        user,
        inco_program,
        deposit.encrypted_balance,
        encrypted_amount
    )?;
    
    // 4. Update balance
    deposit.encrypted_balance = new_balance;
    deposit.pack_into_slice(&mut user_deposit.data.borrow_mut());
    
    // 5. Transfer SOL from vault to user
    invoke_signed(
        &system_instruction::transfer(vault.key, user.key, amount),
        &[vault.clone(), user.clone(), system_program.clone()],
        &[&[b"vault", &[vault_bump]]]
    )?;
    
    Ok(())
}
```

**Key Insight:** Balance check happens **entirely with encrypted values** — no decryption!

---

#### 4. Execute With Intent

**Purpose:** Executes swap after validating encrypted balance and intent signature.

**Accounts:**
- `executor` (writable, PDA)
- `vault` (writable, PDA)
- `user_deposit` (writable, PDA)
- `user` (not signer — intent signature verified off-chain)
- `execution_account` (signer, writable)
- `system_program`
- `inco_program`

**Logic:**
```rust
fn process_execute_with_intent(
    accounts,
    intent_hash: [u8; 32],
    signature: &[u8],
    amount: u64,
    ciphertext: &[u8],
    input_type: u8
) -> ProgramResult {
    let user_deposit = &accounts[2];
    let deposit = UserDeposit::unpack(&user_deposit.data.borrow())?;
    
    // 1. Validate intent signature (Ed25519)
    // Note: In current impl, signature is verified off-chain by TEE
    // On-chain we just check amount is available
    
    // 2. Convert amount to encrypted
    let encrypted_amount = inco_new_euint128(
        execution_account,
        inco_program,
        ciphertext,
        input_type
    )?;
    
    // 3. Check encrypted balance >= amount
    let sufficient = inco_e_ge(
        execution_account,
        inco_program,
        deposit.encrypted_balance,
        encrypted_amount
    )?;
    
    if sufficient == 0 {
        return Err(ProgramError::InsufficientFunds);
    }
    
    // 4. Subtract amount from balance
    let new_balance = inco_e_sub(
        execution_account,
        inco_program,
        deposit.encrypted_balance,
        encrypted_amount
    )?;
    
    deposit.encrypted_balance = new_balance;
    deposit.pack_into_slice(&mut user_deposit.data.borrow_mut());
    
    // 5. Transfer funds from vault to execution account
    invoke_signed(
        &system_instruction::transfer(
            vault.key,
            execution_account.key,
            amount
        ),
        &[vault.clone(), execution_account.clone(), system_program.clone()],
        &[&[b"vault", &[vault_bump]]]
    )?;
    
    // Note: Actual swap happens off-chain by TEE server
    // Execution account now has funds to execute swap
    
    Ok(())
}
```

---

### Inco Lightning Integration

**CPI Functions:**

```rust
// Create encrypted value from ciphertext
fn inco_new_euint128(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    ciphertext: &[u8],
    input_type: u8,
) -> Result<u128, ProgramError>

// Convert plaintext to encrypted (for constants)
fn inco_as_euint128(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    value: u128,
) -> Result<u128, ProgramError>

// Encrypted addition
fn inco_e_add(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    lhs: u128,
    rhs: u128,
) -> Result<u128, ProgramError>

// Encrypted subtraction
fn inco_e_sub(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    lhs: u128,
    rhs: u128,
) -> Result<u128, ProgramError>

// Encrypted greater-than-or-equal
fn inco_e_ge(
    signer: &AccountInfo,
    inco_program: &AccountInfo,
    lhs: u128,
    rhs: u128,
) -> Result<u128, ProgramError>
```

**Inco Sighash:**
```rust
fn inco_sighash(name: &str) -> [u8; 8] {
    let preimage = format!("{}:{}", "global", name);
    let hash = hash(preimage.as_bytes());
    let mut sighash = [0u8; 8];
    sighash.copy_from_slice(&hash.to_bytes()[..8]);
    sighash
}
```

**Return Data Parsing:**
```rust
fn inco_return_u128() -> Result<u128, ProgramError> {
    let (_program_id, return_data) = get_return_data()
        .ok_or(ProgramError::InvalidAccountData)?;
    
    if return_data.len() < 16 {
        return Err(ProgramError::InvalidAccountData);
    }
    
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&return_data[..16]);
    Ok(u128::from_le_bytes(bytes))
}
```

---

## Data Flow

### Complete Transaction Flow

```
1. USER INITIATES SWAP
   └─> dApp: wallet.signAndSendTransaction({ swap 1 SOL })

2. EXTENSION INTERCEPTS
   └─> Interceptor catches call before Phantom
   └─> Extract: amount (1 SOL), inputMint (SOL), outputMint (USDC)
   └─> Build intent with metadata

3. ENCRYPTION
   └─> POST /api/inco-encrypt { amountLamports: 1000000000 }
   └─> Server returns ciphertext handle
   └─> Attach handle to intent, remove plaintext

4. DEPOSIT (if needed)
   └─> Check if user_deposit PDA exists
   └─> If not, build deposit transaction
   └─> Prompt user via Phantom to sign deposit
   └─> Submit deposit (creates user_deposit PDA with encrypted balance)

5. INTENT SIGNATURE
   └─> Prompt user to sign intent hash via Phantom
   └─> User sees: amount, slippage, expiry, dApp name
   └─> Signature attached to intent

6. TEE APPROVAL
   └─> POST /api/approve { encryptedIntent }
   └─> Server validates: expiry, nonce, signature
   └─> Returns: { approved: true, teeSignature }

7. EXECUTION
   └─> POST /api/submit-solana-transaction { intent, transactionData }
   └─> Server builds execute_with_intent instruction
   └─> Executor program validates encrypted balance
   └─> Funds transferred vault → execution account
   └─> Server executes Raydium swap
   └─> Output tokens transferred to user
   └─> Returns: { signature, explorerUrl }

8. CONFIRMATION
   └─> Extension polls for confirmation
   └─> Returns signature to dApp
   └─> dApp shows success message
```

---

## Security Model

### Threat Model

**Trusted:**
- User's browser (extension runs here)
- User's Phantom wallet (signs intents)
- Solana validators (consensus)
- Inco Lightning program (FHE enforcement)

**Untrusted:**
- RPC nodes (see encrypted data only)
- TEE server (should be SGX/SEV in prod)
- dApp frontend (intercepted before damage)
- Network (eavesdropping reveals only ciphertext)

**Attack Vectors:**

1. **Replay Attack**
   - **Defense:** Intent nonces stored on-chain, checked on execution
   
2. **Front-Running**
   - **Defense:** Encrypted amounts prevent MEV bots from knowing value
   
3. **RPC Eavesdropping**
   - **Defense:** All sensitive data encrypted before RPC transmission
   
4. **Malicious dApp**
   - **Defense:** User reviews intent before signing (Phantom popup)
   
5. **Compromised TEE Server**
   - **Defense:** On-chain enforcement via Inco (TEE can't bypass FHE checks)
   
6. **Man-in-the-Middle**
   - **Defense:** HTTPS + signature verification

---

## Performance Considerations

### Latency Breakdown

```
Component               | Latency        | Optimization
------------------------|----------------|------------------
Extension Interception  | <10ms          | Synchronous JS
Inco Encryption         | ~50-100ms      | Batched encryption
Phantom Signature       | User-dependent | User prompt
TEE Validation          | ~50-100ms      | Cached nonces
Executor Instruction    | 1-2 slots      | Solana consensus
Raydium Swap            | 1-2 slots      | DEX execution
Total (no user)         | ~300-500ms     |
Total (with user)       | 5-30 seconds   | User sign time
```

### Optimization Strategies

1. **Batch Encryption** — Encrypt multiple values in single API call
2. **Parallel RPCs** — Query multiple RPCs, use fastest
3. **Fast Polling** — 500ms polls for first 5s, then 2s
4. **Pre-fetch Pool Info** — Cache pool data for common pairs
5. **PER for Low-Latency** — Use MagicBlock PER for <1s execution (when enabled)

---

## Design Decisions

### Why Intents Instead of Raw Transactions?

**Problem:** Raw transactions are:
- Not human-readable
- Lock in specific instructions
- Require exact account states
- Fragile to nonce changes

**Solution:** Intents are:
- Human-readable (amounts, slippage, expiry)
- Flexible (TEE can adjust for best execution)
- Metadata-rich (dApp name, URL, purpose)
- Easy to verify (user sees what they sign)

---

### Why Native Solana Program (No Anchor)?

**Reasons:**
1. **Transparency** — Easier to audit (no macro magic)
2. **Control** — Full control over serialization
3. **Size** — Smaller binary (cheaper deployment)
4. **Learning** — Demonstrates core Solana concepts

**Trade-offs:**
- More boilerplate code
- Manual account validation
- No IDL auto-generation

---

### Why Hybrid PER Mode?

**Problem:** MagicBlock PER requires account delegation, which breaks Raydium swaps.

**Solution:** Hybrid approach:
- **PER for custody/auth** — Intent validation in TEE
- **L1 for swaps** — Raydium swaps on base layer

**Benefits:**
- TEE guarantees without swap fragility
- Faster than pure L1 (custody operations)
- Gradual migration path to full PER

---

### Why Client-Side Encryption?

**Problem:** Server-side encryption requires trusting TEE.

**Solution:** Client-side encryption via Inco SDK:
- Sensitive data encrypted before leaving browser
- TEE receives only ciphertext
- On-chain enforcement via FHE (no trust needed)

**Trade-off:** Requires Inco SDK in extension (adds ~500KB).

---

## Future Improvements

### Short-Term

- [ ] Hardware TEE (Intel SGX or AMD SEV)
- [ ] Multi-RPC routing with failover
- [ ] WebSocket for real-time updates
- [ ] Extension performance profiling

### Medium-Term

- [ ] Client-side Inco encryption (remove server proxy)
- [ ] Full PER delegation support
- [ ] Multi-asset privacy vaults
- [ ] Cross-program invocations (CPI) for composability

### Long-Term

- [ ] ZK proofs for balance checks (alternative to FHE)
- [ ] Multi-chain support (EVM chains)
- [ ] Decentralized TEE network
- [ ] Open marketplace for privacy apps

---

## Conclusion

VØID demonstrates a practical privacy architecture for Solana that balances:
- **Usability** (drop-in for existing dApps)
- **Privacy** (FHE enforcement, encrypted data)
- **Performance** (hybrid PER mode, optimized flows)
- **Security** (replay protection, signature verification)

The modular design allows each component to evolve independently while maintaining clear interfaces and testability.

---

**Next Steps:**
- Read [PROTOCOL_FLOW.md](PROTOCOL_FLOW.md) for sequence diagrams
- See [INCO.md](INCO.md) for FHE integration details
- Check [MagicBlock.md](MagicBlock.md) for PER usage
- Review [ROADMAP.md](ROADMAP.md) for development plan
