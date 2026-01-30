# MagicBlock (PER) in VØID

Reference: https://docs.magicblock.gg/

## Why we use MagicBlock
MagicBlock PER (Private Ephemeral Rollup) is used to execute sensitive or
latency-critical steps inside a TEE-backed rollup, while still settling to
Solana L1. In VØID, PER is intended for **custody/auth steps** where we want
TEE execution guarantees and fast response times.

## Current status (in this repo)
- **PER connection + TEE integrity check**: enabled when `USE_MAGICBLOCK_PER=true`.
- **Swap execution**: **runs on L1** (hybrid flow). We intentionally keep swaps
  on L1 to avoid Raydium delegation edge cases.
- **Funding + intent execution**: handled by the on-chain executor program.

You can see this in:
- `server/modules/magicblock.js` (PER SDK integration)
- `server/modules/swap-executor.js` (PER optional, but currently disabled in server flow)
- `server/server.js` (initialization + status exposure)

## Flow (hybrid mode)
1. Client submits intent (encrypted with Inco handles).
2. TEE server validates intent and prepares execution.
3. Executor program moves funds and enforces rules on-chain.
4. Swap is executed on **L1** (Raydium), not on PER.
5. Output is transferred to the user on L1.

This gives us:
- TEE validation where it matters (intent approval)
- Stable swap execution on L1
- No delegation overhead for Raydium pools

## PER execution mode (optional)
The SDK supports executing arbitrary transactions on PER:
- `executeOnPER()` signs and submits a transaction to PER RPC
- `executeWithPER()` adds delegation checks + commit verification
- `USE_PER_WRAPPER` can wrap a Raydium instruction inside our executor program

**Note:** This is not enabled in the current swap path; see `server/server.js`
where swaps are always executed on L1 (`usePER: false`).

## Configuration
Set in `server/.env`:
- `USE_MAGICBLOCK_PER=true` to initialize PER connection and expose status
- `USE_PER_WRAPPER=false` to disable wrapping Raydium instructions (optional)

### Status endpoint
`GET /api/status` includes:
- `magicblock.enabled`
- RPC + validator + delegation program IDs
- TEE integrity verification status

## Known limitations
- Raydium swaps can be sensitive to account delegation; this is why we keep
  swap execution on L1 for now.
- Token account delegation requires EATA flow (see `delegateSpl` in SDK).

## Next steps (if we want full PER swaps)
- Delegate required accounts (token accounts + PDAs) to PER.
- Enable `usePER` in `server/server.js` swap path.
- Validate wrapper mode with Raydium pools on devnet.
