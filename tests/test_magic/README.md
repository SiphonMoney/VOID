# MagicBlock PER Integration Test

Simple test program to verify MagicBlock PER (Private Ephemeral Rollup) integration.

## What This Tests

1. ✅ Connection to MagicBlock PER RPC
2. ✅ Connection to Solana base layer  
3. ✅ TEE validator availability
4. ✅ Delegation program availability
5. ⏳ Program deployment (manual step)
6. ⏳ Delegation to PER (next step)
7. ⏳ Execution on PER (next step)
8. ⏳ Commit to base layer (next step)

## Setup

```bash
# Install dependencies
npm install

# Set environment variables (uses parent .env)
# SOLANA_EXECUTION_SECRET_KEY or SOLANA_WALLET_SECRET_KEY
# SOLANA_RPC_URL_DEVNET (optional)
```

## Run Tests

```bash
# Basic connectivity test
npm test

# Full test (checks all components)
npm run test-full
```

## Program Structure

- `INITIALIZE` (0): Create counter PDA, set to 0
- `INCREMENT` (1): Increment counter by 1
- `GET_VALUE` (2): Read counter value

## Deployment Steps

1. **Generate program keypair:**
   ```bash
   solana-keygen new -o target/deploy/test_magic-keypair.json
   ```

2. **Build program:**
   ```bash
   cargo build-sbf --manifest-path=Cargo.toml
   ```

3. **Deploy to devnet:**
   ```bash
   solana program deploy target/deploy/test_magic.so \
     --program-id target/deploy/test_magic-keypair.json \
     --url devnet
   ```

4. **Update PROGRAM_ID** in test scripts with deployed program ID

5. **Initialize counter:**
   ```bash
   node deploy.js  # (after updating with real program ID)
   ```

## MagicBlock Integration

- **PER RPC:** `https://tee.magicblock.app/`
- **TEE Validator:** `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`
- **Delegation Program:** `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`

## Next Steps

1. ✅ Basic connectivity (done)
2. ⏳ Deploy program
3. ⏳ Add delegation instructions to program
4. ⏳ Test execution on PER
5. ⏳ Test commit to base layer
