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

In our implementation, the intent carries `inco.handles` (ciphertext + hash/size)
and **does not** include plaintext privacy fields.

## Transmission: ciphertext on-chain
The transaction includes:
- encrypted handles (ciphertext + input_type)
- PDA addresses
- instructions referencing those handles

What the chain sees: handles, signatures, accounts.  
What it never sees: plaintext values or intent parameters.

## On-chain: encrypted state + arithmetic
Core logic happens on-chain with encrypted state:
1. **Store encrypted state** (vault balances, game state, etc.).
2. **Encrypted computation via Inco CPIs**:
   - `new_euint128`, `as_euint128`, `e_add`, `e_sub`, `e_ge`, `e_eq`
3. **Enforcement**:
   - If conditions fail, the transaction fails.
   - No funds move; no side effects occur.

This is where "blind execution still enforces rules" comes from: correctness is
enforced on-chain, while secrecy is preserved.

## Current integration status
We are enforcing Inco in the core executor paths:
- **Deposit**: ciphertext is sent in the deposit instruction and stored as encrypted balance.
- **Withdraw**: amount checks are encrypted (balance >= amount) and enforced on-chain.
- **Swap execute_with_intent**: encrypted amount is validated on-chain, then funds are moved to the executor for swap.

Each of these instructions includes the **Inco Lightning Program** account so CPIs succeed.

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

## Dev note: encryption source
In development, the extension requests ciphertext from the TEE server
(`/api/inco-encrypt`), which uses the Inco SDK to produce ciphertext handles.
