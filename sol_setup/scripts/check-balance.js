// Script to check Solana wallet balance
// Usage: node scripts/check-balance.js [publicKey] [network]

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const publicKey = process.argv[2] || process.env.SOLANA_WALLET_PUBLIC_KEY;
const network = process.argv[3] || process.env.SOLANA_NETWORK || 'devnet';

// Get RPC URL based on network
function getRpcUrl(network) {
  switch (network) {
    case 'mainnet-beta':
      return process.env.SOLANA_RPC_URL_MAINNET || 'https://api.mainnet-beta.solana.com';
    case 'testnet':
      return process.env.SOLANA_RPC_URL_TESTNET || 'https://api.testnet.solana.com';
    case 'devnet':
    default:
      return process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
  }
}

async function main() {
  if (!publicKey) {
    console.error('❌ Usage: node scripts/check-balance.js [publicKey] [network]');
    console.error('   Example: node scripts/check-balance.js 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU devnet');
    console.error('\n   Or set SOLANA_WALLET_PUBLIC_KEY in .env to use default wallet');
    process.exit(1);
  }

  const rpcUrl = getRpcUrl(network);
  console.log(`\n💰 Checking Solana Wallet Balance...\n`);
  console.log(`📍 Network: ${network}`);
  console.log(`🌐 RPC URL: ${rpcUrl}`);
  console.log(`🔑 Public Key: ${publicKey}\n`);

  try {
    // Connect to Solana network
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Import PublicKey dynamically
    const { PublicKey } = await import('@solana/web3.js');
    const walletPublicKey = new PublicKey(publicKey);
    
    // Check balance
    console.log(`📡 Fetching balance...`);
    const balance = await connection.getBalance(walletPublicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💰 Balance: ${balanceSOL.toFixed(4)} SOL`);
    console.log(`   (${balance} lamports)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    if (balanceSOL < 0.1) {
      console.log(`⚠️  Low balance! You may need more SOL for transactions.`);
      if (network === 'devnet') {
        console.log(`   Get free SOL: https://faucet.solana.com/\n`);
      }
    }
    
    // Get account info
    const accountInfo = await connection.getAccountInfo(walletPublicKey);
    if (accountInfo) {
      console.log(`📋 Account Info:`);
      console.log(`   • Owner: ${accountInfo.owner.toString()}`);
      console.log(`   • Executable: ${accountInfo.executable ? 'Yes' : 'No'}`);
      console.log(`   • Rent Epoch: ${accountInfo.rentEpoch}\n`);
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.message.includes('Invalid public key')) {
      console.error(`   Make sure the public key is a valid Solana address.\n`);
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
