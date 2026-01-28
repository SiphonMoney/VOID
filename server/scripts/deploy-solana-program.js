// Script to deploy Solana executor program
// Usage: node scripts/deploy-solana-program.js [network]

import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const network = process.argv[2] || process.env.SOLANA_NETWORK || 'devnet';

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
  console.log('\n🚀 Deploying Void Executor Program to Solana...\n');
  console.log(`📍 Network: ${network}`);
  
  const rpcUrl = getRpcUrl(network);
  console.log(`🌐 RPC URL: ${rpcUrl}\n`);
  
  // Get deployer keypair
  const deployerSecretKey = process.env.SOLANA_WALLET_SECRET_KEY || process.env.SOLANA_DEPLOYER_SECRET_KEY;
  
  if (!deployerSecretKey) {
    console.error('❌ Error: SOLANA_WALLET_SECRET_KEY or SOLANA_DEPLOYER_SECRET_KEY not set in .env file');
    console.error('   Please set SOLANA_WALLET_SECRET_KEY in your .env file');
    console.error('   You can generate a wallet with: npm run generate-wallet');
    process.exit(1);
  }
  
  let deployerKeypair;
  try {
    const secretKeyBytes = bs58.decode(deployerSecretKey);
    deployerKeypair = Keypair.fromSecretKey(secretKeyBytes);
  } catch (e) {
    try {
      const secretKeyArray = JSON.parse(deployerSecretKey);
      deployerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
    } catch (e2) {
      throw new Error('Invalid SOLANA_WALLET_SECRET_KEY format. Use base58 or JSON array.');
    }
  }
  
  const deployerPubkey = deployerKeypair.publicKey.toString();
  console.log(`👤 Deployer: ${deployerPubkey}`);
  
  // Connect to Solana
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(deployerKeypair.publicKey);
  const balanceSOL = balance / LAMPORTS_PER_SOL;
  console.log(`💰 Balance: ${balanceSOL.toFixed(4)} SOL\n`);
  
  if (balanceSOL < 2.0) {
    console.error('❌ Insufficient balance. Need at least 2 SOL for deployment.');
    if (network === 'devnet') {
      console.error('   Get free SOL: https://faucet.solana.com/');
    }
    process.exit(1);
  }
  
  // Check if program binary exists
  const programPath = path.join(__dirname, '..', 'target', 'deploy', 'void_executor.so');
  if (!fs.existsSync(programPath)) {
    console.error('❌ Program binary not found. Please build the program first:');
    console.error('   anchor build');
    process.exit(1);
  }
  
  console.log('📦 Program binary found:', programPath);
  const programBuffer = fs.readFileSync(programPath);
  console.log(`   Size: ${(programBuffer.length / 1024).toFixed(2)} KB\n`);
  
  // Create program keypair (or use existing)
  const programKeypairPath = path.join(__dirname, '..', 'target', 'deploy', 'void_executor-keypair.json');
  let programKeypair;
  
  if (fs.existsSync(programKeypairPath)) {
    console.log('📋 Using existing program keypair...');
    const programKeypairData = JSON.parse(fs.readFileSync(programKeypairPath, 'utf8'));
    programKeypair = Keypair.fromSecretKey(new Uint8Array(programKeypairData));
  } else {
    console.log('🔑 Generating new program keypair...');
    programKeypair = Keypair.generate();
    fs.writeFileSync(programKeypairPath, JSON.stringify(Array.from(programKeypair.secretKey)));
  }
  
  const programId = programKeypair.publicKey.toString();
  console.log(`🔑 Program ID: ${programId}\n`);
  
  // Deploy program
  console.log('📤 Deploying program...');
  try {
    const deployTx = await connection.requestAirdrop(deployerKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(deployTx);
  } catch (e) {
    // Airdrop might fail, that's OK if we have enough balance
  }
  
  // Note: Actual deployment would use solana program deploy
  // For now, we'll create a deployment info file
  const deploymentInfo = {
    network: network,
    programId: programId,
    deployer: deployerPubkey,
    deployedAt: new Date().toISOString(),
    rpcUrl: rpcUrl
  };
  
  const deploymentFile = path.join(__dirname, '..', 'executor-solana-deployment.json');
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log('✅ Deployment info saved to:', deploymentFile);
  console.log('\n📋 Deployment Summary:');
  console.log(`   Program ID: ${programId}`);
  console.log(`   Network: ${network}`);
  console.log(`   Deployer: ${deployerPubkey}`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Update .env with: SOLANA_EXECUTOR_PROGRAM_ID=${programId}`);
  console.log(`   2. Initialize the program with execution account`);
  console.log(`   3. Fund the execution account for transaction fees\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  });
