# MagicBlock PER Authentication Token

## ✅ Where the Auth Token Comes From

The auth token is obtained from the **MagicBlock PER TEE endpoint** using a challenge-response authentication flow.

### Authentication Flow

1. **Request Challenge**
   - **Endpoint**: `https://tee.magicblock.app/auth/challenge?pubkey={publicKey}`
   - **Method**: GET
   - **Returns**: `{ challenge: string }` or `{ error: string }`

2. **Sign Challenge**
   - User signs the challenge message with their Ed25519 private key (Solana standard)
   - Uses `nacl.sign.detached(message, secretKey)`

3. **Submit Signature & Get Token**
   - **Endpoint**: `https://tee.magicblock.app/auth/login`
   - **Method**: POST
   - **Body**: `{ pubkey, challenge, signature }`
   - **Returns**: `{ token: string, expiresAt: number }`

### Implementation

We use the MagicBlock SDK's `getAuthToken()` function:

```javascript
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk';

const tokenData = await getAuthToken(
  'https://tee.magicblock.app',  // Note: NO trailing slash
  wallet.publicKey,
  async (message) => nacl.sign.detached(message, wallet.secretKey)
);

// Returns: { token: string, expiresAt: number }
// Token expires in 30 days (SESSION_DURATION)
```

### Current Status

✅ **Auth token is working!** 
- Fixed URL double-slash issue
- Token successfully obtained
- Expires in 30 days

### Token Usage

The token is used in the PER RPC URL:
```
https://tee.magicblock.app?token={token}
```

### Code Location

- **Function**: `getPERAuthToken()` in `modules/magicblock.js`
- **SDK Source**: `node_modules/@magicblock-labs/ephemeral-rollups-sdk/lib/access-control/auth.js`
- **Endpoints**:
  - Challenge: `/auth/challenge?pubkey={pubkey}`
  - Login: `/auth/login` (POST)

### Notes

- Token is cached and auto-refreshed 5 minutes before expiry
- Token lasts 30 days (SESSION_DURATION)
- No API key needed - just sign with your wallet
- Works with any Solana keypair
