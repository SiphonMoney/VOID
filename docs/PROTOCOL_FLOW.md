# Void protocol flow (from `protocol_void.png`)

This is a plain‑English translation of the system diagram so the end‑to‑end
data flow is unambiguous.

## Actors
- **Dapp (unchanged UX)**: standard Solana app calls (`wallet.signTransaction`,
  `wallet.sendTransaction`, etc.).
- **Extension (consent + privacy)**: injects wallet wrapper, intercepts intent,
  encrypts sensitive data, and selects RPC/executor route.
- **MagicBlock PER (TEE)**: validates intent, builds transaction, executes.
- **Inco (amount privacy)**: on‑chain privacy enforcement (encrypted values).
- **RPC operators**: transport only; never see intent context.
- **User**: signs intent, funds the executor vault.
- **PDA vault**: holds executor fees/assets without revealing identity.

## End‑to‑end flow
1. **User interacts with a normal Solana dapp**
   - Dapp calls standard wallet functions; UI stays the same.
2. **Extension injects a wallet wrapper**
   - Wallet calls are intercepted before reaching the RPC.
3. **Extension builds a Solana intent**
   - Instead of a full transaction, the extension builds an intent
     (instruction graph + metadata).
4. **Extension encrypts the intent for the TEE**
   - Sensitive fields are encrypted client‑side.
   - Only the enclave can decrypt; browser/RPC/relayers cannot.
5. **Extension sends encrypted intent to TEE**
   - No RPC logs or mempool visibility of intent details.
6. **Extension selects RPC/executor route**
   - Automatic or manual selection; can rotate or bring‑your‑own RPC.
7. **MagicBlock PER validates intent**
   - Decrypt intent, verify signature, check limits (nonce/expiry/spend).
   - “Host machine is blind.”
8. **MagicBlock PER builds the transaction**
   - Fees paid by executor.
   - Instructions are exactly as the user intended.
   - User never signs on‑chain transactions directly.
9. **MagicBlock PER executes**
   - Submits via executor program or chosen RPC.
   - Spend from vault; uses intent to sign.
   - Execution without attribution.
10. **Ciphertexts go to the executor program**
    - Ciphertexts are created off‑chain and passed into the on‑chain executor.
    - They are never decrypted on‑chain.
11. **Inco enforces amount privacy**
    - Executor program verifies intent.
    - Encrypted arithmetic + on‑chain enforcement.
    - Executes CPI to target programs.
12. **RPC operators transport the signed transaction**
    - Receive signed transaction only.
    - No user wallet, no intent context, no identity signal.
13. **PDA vault receives assets**
    - Assets settle without revealing user identity.

## What stays private
- Intent parameters, amounts, and user metadata (encrypted before RPC).
- Executor and RPC never see plaintext.
- On‑chain logic enforces correctness with encrypted values.
