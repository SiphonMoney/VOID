# Inco in Void (blind executor flow)

Reference: https://docs.inco.org/svm/home

## Start: client-side encryption (entry point)
All sensitive values are encrypted **before** transaction creation:
- amount
- balance delta
- game guess
- threshold
- any private parameter

Using the Inco SDK, the client produces ciphertext handles. The wallet signs
**after** encryption. Neither the executor nor the RPC can see plaintext.

## Transmission: ciphertext on-chain
The transaction includes:
- encrypted handles
- PDA addresses
- instructions referencing those handles

What the chain sees: handles, signatures, accounts.  
What it never sees: plaintext values or intent parameters.

## On-chain: encrypted state + arithmetic
Core logic happens on-chain with encrypted state:
1. **Store encrypted state** (vault balances, game state, etc.).
2. **Encrypted computation via Inco CPIs**:
   - `encrypted_add`, `encrypted_sub`, `encrypted_compare`, `encrypted_select`, ...
3. **Enforcement**:
   - If conditions fail, the transaction fails.
   - No funds move; no side effects occur.

This is where "blind execution still enforces rules" comes from: correctness is
enforced on-chain, while secrecy is preserved.

## Access control: no decryption in our flow
We do not request decryption in the protocol path:
- Executor has no decryption rights
- Program does not request decryption
- No off-chain reveal

Encrypted handles remain encrypted on-chain.

## End: encrypted state committed
After execution:
- encrypted handles and PDAs are updated on-chain
- transaction record exists
- plaintext never appears

Inco's responsibility ends here; executor and RPC exit without seeing secrets.
