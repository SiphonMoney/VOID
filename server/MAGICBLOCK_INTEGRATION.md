# MagicBlock PER Integration

This document describes the MagicBlock PER (Private Ephemeral Rollup) integration for AnonyMaus.

## Overview

MagicBlock PER provides a TEE (Trusted Execution Environment) infrastructure for executing Solana transactions privately. When enabled, swap transactions execute on MagicBlock's PER instead of the base Solana layer.

## Architecture

### Components

1. **MagicBlock Module** (`modules/magicblock.js`)
   - PER connection management
   - Account delegation
   - Transaction execution on PER
   - State commit to base layer

2. **Swap Executor** (`modules/swap-executor.js`)
   - Updated to support PER execution
   - Automatic fallback to base layer if PER fails

3. **Server** (`server.js`)
   - PER initialization on startup
   - Configuration via environment variable

## Configuration

### Enable MagicBlock PER

Add to `.env`:
```bash
USE_MAGICBLOCK_PER=true
```

### MagicBlock Constants

- **PER RPC**: `https://tee.magicblock.app/`
- **PER WS**: `wss://tee.magicblock.app/`
- **TEE Validator**: `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`
- **Delegation Program**: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`

## How It Works

### Execution Flow

1. **Intent Approval** (unchanged)
   - User signs intent
   - Server decrypts and validates
   - Returns approval

2. **Transaction Execution** (PER-enabled)
   - If `USE_MAGICBLOCK_PER=true`:
     - Transaction executes on PER RPC
     - State automatically committed to base layer
   - If disabled or PER fails:
     - Falls back to base layer execution

3. **State Commit**
   - MagicBlock automatically commits PER state to base layer
   - No manual commit required

### Account Delegation

Currently, account delegation is a placeholder. Full implementation requires:
- MagicBlock SDK integration
- Delegation instruction format
- Account ownership verification

## Testing

### Test Script

See `test_magic/` directory for a simple test program that demonstrates:
- PER connection
- Basic program execution
- Counter increment on PER

### Enable in Production

1. Set `USE_MAGICBLOCK_PER=true` in `.env`
2. Restart server
3. Check `/api/status` endpoint for PER status
4. Monitor swap transactions - they should execute on PER

## Status Endpoint

Check PER status:
```bash
curl http://localhost:3001/api/status
```

Response includes:
```json
{
  "status": "operational",
  "magicblock": {
    "enabled": true,
    "rpc": "https://tee.magicblock.app/",
    "teeValidator": "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
    "delegationProgram": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
  }
}
```

## Benefits

1. **Privacy**: Transactions execute in TEE, hiding execution details
2. **Zero Fees**: PER transactions have zero fees
3. **Real-time**: Instant execution on PER
4. **Automatic Commit**: State automatically synced to base layer

## Limitations

1. **Delegation**: Full delegation support requires MagicBlock SDK
2. **Account Setup**: Accounts may need manual delegation initially
3. **Fallback**: Falls back to base layer if PER unavailable

## Future Enhancements

1. Full MagicBlock SDK integration
2. Automatic account delegation
3. PER-specific instruction building
4. Enhanced error handling and retry logic
