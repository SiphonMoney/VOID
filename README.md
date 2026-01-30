# VØID — Web3 Anonymizer for Solana

VØID is a privacy‑first **anonymizer** for Solana — think **VPN for Web3
transactions**. It lets users sign **intents** (not transactions), encrypts
sensitive fields client‑side, and enforces confidential rules on‑chain via
**Inco Lightning**. Execution is coordinated by a **MagicBlock PER** and partner RPC routing offered by the **Quicknode**.

## Why it matters
- **Confidential by default**: amounts and intent parameters are encrypted before RPC.
- **On‑chain enforcement**: rules are verified with encrypted arithmetic, not trust.
- **Drop‑in UX**: dApps use standard wallet APIs; the extension intercepts and reroutes.
- **Composable infrastructure**: works with partner RPCs, rollups, and privacy SDKs.

## Core features
- Intent interception + signing (browser extension)
- Inco encrypted handles + on‑chain checks (deposit/withdraw/execute)
- TEE approval and execution pipeline
- MagicBlock PER integration (real‑time private execution)
- RPC selection (default/public/partner/custom) passed end‑to‑end

## Architecture (overview)
**Client layer**
- Browser extension intercepts wallet calls and builds intents.
- Client‑side encryption produces Inco ciphertext handles.

**TEE layer**
- Validates intent and signature (nonce/expiry/limits).
- Builds and submits execution transactions.
- Selects RPC route (default/public/partner/custom).

**On‑chain layer**
- Executor program holds vaults and enforces rules.
- Inco Lightning CPIs perform encrypted arithmetic checks.
- Swaps execute and output is transferred to the user.

More detail: `docs/PROTOCOL_FLOW.md`

## Repository structure (key paths)
- `extension/` — browser extension UI, interceptor, signer
  - `background.js` — intent + routing pipeline
  - `content.js` — page injection + messaging bridge
  - `functions/` — intent builder, signer, interceptor, encryption
- `server/` — TEE executor server + Solana program
  - `server.js` — TEE API and execution orchestration
  - `modules/` — MagicBlock, swap execution, intent validation, logging
  - `programs/anonymaus-executor/` — on‑chain executor (Rust)
- `test_inco/` — Inco test harness (basic + full flow)
- `docs/` — protocol, partners, roadmap, and hackathon docs

## Quick start (dev)
### 1) Server
```
cd server
npm install
npm start
```

### 2) Build + deploy program (devnet)
```
cd server
npm run build-program
npm run deploy-program
npm run initialize-solana-program
```

### 3) Extension
Load `extension/` as an unpacked extension in Chrome.

### 4) Inco tests (optional)
```
cd test_inco
npm install
npm run test:inco
```

## Configuration (dev)
Server environment: `server/.env`
- `SOLANA_EXECUTOR_PROGRAM_ID`
- `SOLANA_EXECUTION_SECRET_KEY`
- `SOLANA_RPC_URL_DEVNET`
- `USE_MAGICBLOCK_PER` (true/false)

RPC selection is set in the extension **Settings** and passed to the server.

## Docs
- Inco flow: `docs/INCO.md`
- MagicBlock PER: `docs/MagicBlock.md`
- Protocol flow: `docs/PROTOCOL_FLOW.md`
- Roadmap: `docs/ROADMAP.md`
- Quicknode (hackathon): `docs/Quicknode.md`
- Tracks & partners: `docs/TRACKS_AND_PARTNERS.md`

## Status
This repo is a working prototype with a TEE server backed by MagicBlock PER for development. It is
not production‑ready without hardening, audits, and operational safeguards.
