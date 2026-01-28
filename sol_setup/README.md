# AnonyMaus Solana Backend

Backend utilities for Solana wallet management and funding.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Generate a new wallet:
```bash
npm run generate-wallet [network]
```

Networks: `devnet` (default), `mainnet-beta`, `testnet`

This will:
- Generate a new Solana keypair
- Save wallet info to `wallets/wallet-{network}-{timestamp}.json`
- Update `.env` file with wallet configuration

## Scripts

### Generate Wallet
```bash
npm run generate-wallet [network]
```

Creates a new Solana wallet keypair and saves it securely.

### Check Balance
```bash
npm run check-balance [publicKey] [network]
```

Check the balance of a Solana wallet. Uses `.env` values if no arguments provided.

### Fund Wallet
```bash
npm run fund-wallet [publicKey] [amount] [network]
```

Fund a Solana wallet from your funder wallet. Requires `FUNDER_SECRET_KEY` in `.env`.

## Environment Variables

Create a `.env` file with:

```env
# Solana Wallet Configuration
SOLANA_NETWORK=devnet
SOLANA_WALLET_PUBLIC_KEY=your_public_key_here
SOLANA_WALLET_SECRET_KEY=your_secret_key_base58_here

# Funder wallet (for funding other wallets)
FUNDER_SECRET_KEY=your_funder_secret_key_base58_here

# RPC Endpoints
SOLANA_RPC_URL_DEVNET=https://api.devnet.solana.com
SOLANA_RPC_URL_MAINNET=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL_TESTNET=https://api.testnet.solana.com
```

## Security Warning

⚠️ **NEVER commit wallet files or `.env` to version control!**

- Wallet files contain private keys
- Keep your secret keys secure
- Use `.gitignore` to exclude sensitive files

## Getting Test SOL

### Devnet
Visit https://faucet.solana.com/ and request SOL for your devnet wallet address.

### Mainnet
Send SOL from another wallet or purchase from an exchange.

## Next Steps

1. Generate a wallet: `npm run generate-wallet devnet`
2. Fund it: Visit https://faucet.solana.com/ (devnet) or send SOL (mainnet)
3. Check balance: `npm run check-balance`
4. Use the wallet for deploying programs and executing transactions
