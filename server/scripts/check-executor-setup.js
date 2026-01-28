// Check Solana Executor Program Setup
// Verifies that all required components are configured and working

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const network = process.env.SOLANA_NETWORK || 'devnet';
const rpcUrl = process.env.SOLANA_RPC_URL_DEVNET || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

console.log('\n🔍 Checking Solana Executor Program Setup...\n');
console.log(`📍 Network: ${network}`);
console.log(`🌐 RPC URL: ${rpcUrl}\n`);

const connection = new Connection(rpcUrl, 'confirmed');

let allGood = true;

// 1. Check Executor Program ID
console.log('1️⃣  Checking Executor Program ID...');
const executorProgramId = process.env.SOLANA_EXECUTOR_PROGRAM_ID || process.env.SOLANA_EXECUTOR_PUBLIC_KEY;
if (!executorProgramId || executorProgramId === 'AnonyMausExecutor111111111111111111111111' || executorProgramId === '11111111111111111111111111111111') {
  console.log('   ❌ SOLANA_EXECUTOR_PROGRAM_ID not set or using placeholder');
  console.log('   💡 Deploy the program first: npm run deploy-solana-program');
  allGood = false;
} else {
  console.log(`   ✅ Program ID: ${executorProgramId}`);
  
  // Check if program is deployed
  try {
    const programPubkey = new PublicKey(executorProgramId);
    const programInfo = await connection.getAccountInfo(programPubkey);
    if (programInfo && programInfo.executable) {
      console.log(`   ✅ Program is deployed and executable`);
      console.log(`   📊 Program data length: ${programInfo.data.length} bytes`);
    } else {
      console.log(`   ❌ Program account exists but is not executable`);
      console.log(`   💡 Redeploy: npm run deploy-solana-program`);
      allGood = false;
    }
  } catch (error) {
    console.log(`   ❌ Program not found on-chain: ${error.message}`);
    console.log(`   💡 Deploy the program: npm run deploy-solana-program`);
    allGood = false;
  }
}

console.log('');

// 2. Check Execution Secret Key
console.log('2️⃣  Checking Execution Secret Key...');
const executionSecretKey = process.env.SOLANA_EXECUTION_SECRET_KEY || process.env.SOLANA_WALLET_SECRET_KEY;
if (!executionSecretKey) {
  console.log('   ❌ SOLANA_EXECUTION_SECRET_KEY not set');
  console.log('   💡 Set it in .env file (base58 format)');
  console.log('   💡 You can use a wallet from extra_back or generate a new one');
  allGood = false;
} else {
  try {
    let executionKeypair;
    try {
      const secretKeyBytes = bs58.decode(executionSecretKey);
      executionKeypair = Keypair.fromSecretKey(secretKeyBytes);
    } catch (e) {
      try {
        const secretKeyArray = JSON.parse(executionSecretKey);
        executionKeypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
      } catch (e2) {
        throw new Error('Invalid format. Use base58 or JSON array.');
      }
    }
    
    const executionPubkey = executionKeypair.publicKey.toString();
    console.log(`   ✅ Execution keypair loaded`);
    console.log(`   🔑 Public Key: ${executionPubkey}`);
    
    // Check balance
    const balance = await connection.getBalance(executionKeypair.publicKey);
    const balanceSOL = balance / 1e9;
    console.log(`   💰 Balance: ${balanceSOL.toFixed(4)} SOL`);
    
    if (balanceSOL < 0.1) {
      console.log(`   ⚠️  Low balance! Need at least 0.1 SOL for transactions`);
      if (network === 'devnet') {
        console.log(`   💡 Get free SOL: https://faucet.solana.com/`);
      }
    }
  } catch (error) {
    console.log(`   ❌ Invalid execution secret key: ${error.message}`);
    allGood = false;
  }
}

console.log('');

// 3. Check Executor PDA
if (executorProgramId && executorProgramId !== 'AnonyMausExecutor111111111111111111111111' && executorProgramId !== '11111111111111111111111111111111') {
  console.log('3️⃣  Checking Executor PDA...');
  try {
    const programPubkey = new PublicKey(executorProgramId);
    const [executorPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('executor')],
      programPubkey
    );
    
    console.log(`   ✅ Executor PDA: ${executorPDA.toString()}`);
    
    // Check if PDA account exists (program initialized)
    const pdaInfo = await connection.getAccountInfo(executorPDA);
    if (pdaInfo) {
      console.log(`   ✅ Executor PDA account exists (program initialized)`);
      console.log(`   📊 Account data length: ${pdaInfo.data.length} bytes`);
    } else {
      console.log(`   ⚠️  Executor PDA account not found (program not initialized)`);
      console.log(`   💡 Initialize: node scripts/initialize-solana-program.js <executionAccountPubkey>`);
    }
  } catch (error) {
    console.log(`   ❌ Error checking PDA: ${error.message}`);
  }
}

console.log('');

// 4. Check Vault PDA
if (executorProgramId && executorProgramId !== 'AnonyMausExecutor111111111111111111111111' && executorProgramId !== '11111111111111111111111111111111') {
  console.log('4️⃣  Checking Vault PDA...');
  try {
    const programPubkey = new PublicKey(executorProgramId);
    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault')],
      programPubkey
    );
    
    console.log(`   ✅ Vault PDA: ${vaultPDA.toString()}`);
    
    const vaultInfo = await connection.getAccountInfo(vaultPDA);
    if (vaultInfo) {
      const balance = await connection.getBalance(vaultPDA);
      const balanceSOL = balance / 1e9;
      console.log(`   💰 Vault balance: ${balanceSOL.toFixed(4)} SOL`);
    } else {
      console.log(`   ℹ️  Vault PDA account not created yet (will be created on first deposit)`);
    }
  } catch (error) {
    console.log(`   ❌ Error checking vault: ${error.message}`);
  }
}

console.log('');

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (allGood) {
  console.log('✅ All checks passed! Executor program is ready.');
} else {
  console.log('❌ Some checks failed. Please fix the issues above.');
  console.log('\n📋 Quick Setup Guide:');
  console.log('   1. Deploy program: npm run deploy-solana-program');
  console.log('   2. Set SOLANA_EXECUTOR_PROGRAM_ID in .env');
  console.log('   3. Set SOLANA_EXECUTION_SECRET_KEY in .env');
  console.log('   4. Initialize program: node scripts/initialize-solana-program.js <executionPubkey>');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(allGood ? 0 : 1);
