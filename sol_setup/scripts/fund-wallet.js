// Script to fund a Solana wallet
// Usage: node scripts/fund-wallet.js [publicKey] [amount] [network]
// Example: node scripts/fund-wallet.js <publicKey> 1.0 devnet

import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const targetPublicKey = process.argv[2];
const amount = parseFloat(process.argv[3] || '1.0'); // Default 1 SOL
const network = process.argv[4] || process.env.SOLANA_NETWORK || 'devnet';

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
  if (!targetPublicKey) {
    console.error('❌ Usage: node scripts/fund-wallet.js <publicKey> [amount] [network]');
    console.error('   Example: node scripts/fund-wallet.js 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 1.0 devnet');
    console.error('\n   Or set SOLANA_WALLET_PUBLIC_KEY in .env to use default wallet');
    process.exit(1);
  }

  // Get funder wallet from environment
  const funderSecretKey = process.env.FUNDER_SECRET_KEY || process.env.SOLANA_WALLET_SECRET_KEY;
  
  if (!funderSecretKey) {
    console.error('❌ Error: FUNDER_SECRET_KEY or SOLANA_WALLET_SECRET_KEY not set in .env file');
    console.error('   Please set FUNDER_SECRET_KEY in your .env file');
    console.error('   This should be the secret key (base58) of a wallet that has SOL to send');
    process.exit(1);
  }

  const rpcUrl = getRpcUrl(network);
  console.log(`\n💰 Funding Solana Wallet...\n`);
  console.log(`📍 Network: ${network}`);
  console.log(`🌐 RPC URL: ${rpcUrl}`);
  console.log(`🎯 Target: ${targetPublicKey}`);
  console.log(`💰 Amount: ${amount} SOL\n`);

  try {
    // Connect to Solana network
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Load funder keypair
    let funderKeypair;
    try {
      // Try base58 first (most common)
      const secretKeyBytes = bs58.decode(funderSecretKey);
      funderKeypair = Keypair.fromSecretKey(secretKeyBytes);
    } catch (e) {
      // Try as JSON array
      try {
        const secretKeyArray = JSON.parse(funderSecretKey);
        funderKeypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
      } catch (e2) {
        throw new Error('Invalid secret key format. Use base58 or JSON array.');
      }
    }
    
    const funderPublicKey = funderKeypair.publicKey.toString();
    console.log(`👤 Funder: ${funderPublicKey}`);
    
    // Check funder balance
    const funderBalance = await connection.getBalance(funderKeypair.publicKey);
    const funderBalanceSOL = funderBalance / LAMPORTS_PER_SOL;
    
    console.log(`💰 Funder Balance: ${funderBalanceSOL.toFixed(4)} SOL`);
    
    // Calculate amount in lamports
    const amountLamports = amount * LAMPORTS_PER_SOL;
    
    // Estimate transaction fee (roughly 5000 lamports for a simple transfer)
    const estimatedFee = 5000;
    const totalNeeded = amountLamports + estimatedFee;
    
    if (funderBalance < totalNeeded) {
      console.error(`\n❌ Insufficient balance.`);
      console.error(`   Need: ${(totalNeeded / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      console.error(`   Have: ${funderBalanceSOL.toFixed(4)} SOL`);
      console.error(`   Shortfall: ${((totalNeeded - funderBalance) / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);
      process.exit(1);
    }
    
    // Get recent blockhash
    console.log(`\n📡 Getting recent blockhash...`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    // Create transfer transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funderKeypair.publicKey,
        toPubkey: new (await import('@solana/web3.js')).PublicKey(targetPublicKey),
        lamports: amountLamports,
      })
    );
    
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = funderKeypair.publicKey;
    
    // Sign transaction
    console.log(`✍️  Signing transaction...`);
    transaction.sign(funderKeypair);
    
    // Send transaction
    console.log(`📤 Sending ${amount} SOL to ${targetPublicKey}...`);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });
    
    console.log(`📋 Transaction Signature: ${signature}`);
    console.log(`⏳ Waiting for confirmation...`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight
    }, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    console.log(`✅ Transaction confirmed!`);
    console.log(`   Block: ${confirmation.value.slot}`);
    
    // Check new balance
    const targetBalance = await connection.getBalance(new (await import('@solana/web3.js')).PublicKey(targetPublicKey));
    const targetBalanceSOL = targetBalance / LAMPORTS_PER_SOL;
    
    console.log(`\n✅ Funding complete!`);
    console.log(`💰 New Balance: ${targetBalanceSOL.toFixed(4)} SOL`);
    console.log(`\n🔗 View on explorer:`);
    console.log(`   ${network === 'mainnet-beta' ? 'https://solscan.io/tx/' : `https://solscan.io/tx/${signature}?cluster=${network}`}${signature}\n`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.logs) {
      console.error('Transaction logs:', error.logs);
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
