# MagicBlock PER Full Integration Guide

Complete implementation of MagicBlock PER (Private Ephemeral Rollup) for AnonyMaus TEE execution.

## ✅ What's Implemented

### 1. SDK Integration
- ✅ Installed `@magicblock-labs/ephemeral-rollups-sdk`
- ✅ TEE RPC integrity verification
- ✅ Authorization token management
- ✅ Transaction preparation for PER

### 2. Core Functions (`modules/magicblock.js`)

#### Connection Management
- `initializePERConnection()` - Initialize with TEE verification
- `getPERConnection()` - Get authenticated connection
- `getPERAuthToken()` - Get/refresh auth tokens ✅ **Working!**

#### Delegation
- `isAccountDelegated()` - Check delegation status
- `delegateAccountToPER()` - Delegate accounts to PER

#### Execution
- `executeOnPER()` - Execute transactions on PER with auth
- `prepareTransactionForPER()` - Prepare transactions for PER
- `commitToBaseLayer()` - Verify state commit

#### High-Level
- `executeWithPER()` - Full flow: delegate → execute → commit

### 3. Integration Points

#### Server (`server.js`)
- PER initialization on startup
- Environment variable toggle (`USE_MAGICBLOCK_PER`)
- Status endpoint shows PER info
- Automatic PER execution when enabled

#### Swap Executor (`modules/swap-executor.js`)
- `usePER` parameter for PER execution
- Automatic fallback to base layer
- PER connection with authentication

## 🔧 Configuration

### Environment Variables

```bash
# Enable/disable PER execution
USE_MAGICBLOCK_PER=true

# Optional: MagicBlock API token (for enhanced features)
MAGICBLOCK_API_TOKEN=your_token_here
```

### MagicBlock Constants

- **PER RPC**: `https://tee.magicblock.app/`
- **TEE Validator**: `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`
- **Delegation Program**: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- **Permission Program**: `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`

## 🚀 Usage

### Basic Execution

```javascript
import { executeOnPER, getPERConnection } from './modules/magicblock.js';

// Execute transaction on PER
const result = await executeOnPER(
  transaction,
  signerKeypair,
  baseConnection,
  log
);
```

### With Automatic Delegation

```javascript
import { executeWithPER } from './modules/magicblock.js';

// Full flow: check delegation → delegate if needed → execute → commit
const result = await executeWithPER({
  baseConnection,
  transaction,
  signer: executionKeypair,
  accountPubkey: counterPDA,
  programId: PROGRAM_ID,
  seeds: [Buffer.from('counter')],
  log,
});
```

### Manual Delegation

```javascript
import { delegateAccountToPER } from './modules/magicblock.js';

// Delegate account to PER
const sig = await delegateAccountToPER(
  baseConnection,
  payerKeypair,
  accountPubkey,
  programId,
  seeds, // For PDA accounts
  log
);
```

## 📋 How It Works

### 1. Initialization
- Server starts → verifies TEE RPC integrity
- Initializes PER connection
- Sets up auth token management

### 2. Transaction Execution Flow

```
User Intent → Server Approval → Build Transaction
                                      ↓
                            [USE_MAGICBLOCK_PER=true?]
                                      ↓
                              ┌───────┴───────┐
                              │               │
                         Yes (PER)        No (Base)
                              │               │
                    Check Delegation    Execute on Base
                              │               │
                    Delegate if needed        │
                              │               │
                    Get Auth Token            │
                              │               │
                    Execute on PER            │
                              │               │
                    Commit to Base            │
                              │               │
                              └───────┬───────┘
                                      ↓
                              Return Signature
```

### 3. Authentication ✅ **Working!**
- Uses `getAuthToken()` from SDK
- Signs message with execution keypair
- Token cached and auto-refreshed (30 day expiry)
- Added to RPC URL: `https://tee.magicblock.app?token={token}`
- **Auth endpoint**: `https://tee.magicblock.app/auth/challenge` → `/auth/login`

### 4. Delegation
- Checks account ownership
- If not delegated, calls delegation program
- Uses TEE validator for PER
- Supports PDA accounts with seeds

### 5. State Commit
- MagicBlock automatically commits PER state
- We verify commit by checking signature status
- State synced to base layer

## 🧪 Testing

### Run Integration Test

```bash
npm run test-magicblock
```

Tests:
1. PER connection initialization
2. TEE integrity verification
3. Auth token retrieval
4. Account delegation check
5. Transaction execution on PER
6. State commit verification

### Test with Real Swap

1. Set `USE_MAGICBLOCK_PER=true` in `.env`
2. Restart server
3. Execute swap via extension
4. Check logs for PER execution
5. Verify transaction on explorer

## 🔐 Security Features

1. **TEE Integrity Verification**
   - Verifies TEE RPC via Phala Network
   - Ensures authentic TEE endpoint

2. **Authorization Tokens**
   - User signs message for auth
   - Tokens expire and auto-refresh
   - Prevents unauthorized access

3. **Account Delegation**
   - Only authorized accounts can delegate
   - PDA signing for secure delegation
   - Validator verification

## ⚠️ Limitations & Notes

1. **Rust Program Updates**
   - Executor program needs delegation hooks
   - Add `#[ephemeral]` and `#[delegate]` attributes
   - Requires `ephemeral-rollups-sdk` Rust dependency

2. **PER Wrapper Program**
   - A CPI wrapper exists in `programs/anonymaus-executor` to call Raydium
   - The wrapper can only execute on PER if **all writable accounts** are delegatable
   - Raydium pool/vault accounts are program-owned and **cannot be delegated client-side**
   - Full PER swaps require **PER-compatible pools** or program-side delegation hooks in the pool program

3. **Account Delegation**
   - Currently client-side delegation
   - Full support requires program-side hooks
   - PDA delegation needs `invoke_signed`

4. **Auth Token** ✅ **Working!**
   - No API key needed - just wallet signature
   - Token obtained from `/auth/challenge` → `/auth/login`
   - Token expires in 30 days, auto-refreshed

## 📚 Resources

- [MagicBlock Docs](https://docs.magicblock.gg/)
- [PER Quickstart](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart)
- [SDK GitHub](https://github.com/magicblock-labs/ephemeral-rollups-sdk)
- [Example Programs](https://github.com/magicblock-labs/magicblock-engine-examples)

## 🎯 Next Steps

1. ✅ SDK installed and integrated
2. ✅ Core functions implemented
3. ✅ Server integration complete
4. ⏳ Add delegation hooks to Rust program
5. ⏳ Test with real swap transactions
6. ⏳ Production deployment

## 🐛 Troubleshooting

### "Missing token query param"
- Auth token not obtained
- Check `getPERAuthToken()` call
- Verify keypair signing works

### "Account not delegated"
- Account needs delegation first
- Call `delegateAccountToPER()`
- Check delegation program access

### "TEE integrity verification failed"
- Network issue or endpoint change
- Check MagicBlock status
- May continue without verification

### "Transaction failed on PER"
- Check account delegation
- Verify auth token
- Ensure program supports PER
- Falls back to base layer automatically
