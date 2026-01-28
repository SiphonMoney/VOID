// Simple test script for MagicBlock PER integration
// Tests: deploy, initialize, delegate, execute on PER, commit

import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'fs';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// MagicBlock constants
const MAGICBLOCK_PER_RPC = 'https://tee.magicblock.app/';
const MAGICBLOCK_PER_WS = 'wss://tee.magicblock.app/';
const TEE_VALIDATOR = new PublicKey('FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA');
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');

// Solana base layer
const BASE_RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
const baseConnection = new Connection(BASE_RPC, 'confirmed');

// MagicBlock PER
const perConnection = new Connection(MAGICBLOCK_PER_RPC, 'confirmed', {
  wsEndpoint: MAGICBLOCK_PER_WS,
});

async function testMagicBlock() {
  console.log('\n🧪 Testing MagicBlock PER Integration\n');

  // 1. Load or create test keypair
  const payerSecretKey = process.env.SOLANA_EXECUTION_SECRET_KEY || process.env.SOLANA_WALLET_SECRET_KEY;
  if (!payerSecretKey) {
    throw new Error('SOLANA_EXECUTION_SECRET_KEY or SOLANA_WALLET_SECRET_KEY required');
  }

  let payerKeypair;
  try {
    payerKeypair = Keypair.fromSecretKey(bs58.decode(payerSecretKey));
  } catch (e) {
    payerKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(payerSecretKey)));
  }

  console.log(`✅ Payer: ${payerKeypair.publicKey.toBase58()}\n`);

  // 2. Check balance
  const balance = await baseConnection.getBalance(payerKeypair.publicKey);
  console.log(`💰 Balance: ${balance / 1e9} SOL\n`);

  if (balance < 0.1 * 1e9) {
    console.log('⚠️  Low balance - may need airdrop for testing\n');
  }

  // 3. Program ID (will be set after deployment)
  // For now, use a placeholder - in real test, deploy program first
  const PROGRAM_ID = new PublicKey('11111111111111111111111111111111'); // Replace after deployment

  // 4. Derive counter PDA
  const [counterPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('counter')],
    PROGRAM_ID
  );

  console.log(`📋 Counter PDA: ${counterPDA.toBase58()}\n`);

  // 5. Test PER connection
  console.log('🔍 Testing PER connection...');
  try {
    const perBlockhash = await perConnection.getLatestBlockhash('confirmed');
    console.log(`✅ PER connection working (blockhash: ${perBlockhash.blockhash.slice(0, 8)}...)\n`);
  } catch (error) {
    console.error(`❌ PER connection failed: ${error.message}\n`);
    throw error;
  }

  // 6. Test base layer connection
  console.log('🔍 Testing base layer connection...');
  try {
    const baseBlockhash = await baseConnection.getLatestBlockhash('confirmed');
    console.log(`✅ Base layer connection working (blockhash: ${baseBlockhash.blockhash.slice(0, 8)}...)\n`);
  } catch (error) {
    console.error(`❌ Base layer connection failed: ${error.message}\n`);
    throw error;
  }

  console.log('✅ Basic connectivity tests passed!\n');
  console.log('📝 Next steps:');
  console.log('   1. Deploy test program to devnet');
  console.log('   2. Initialize counter PDA');
  console.log('   3. Delegate counter PDA to MagicBlock PER');
  console.log('   4. Execute increment on PER');
  console.log('   5. Commit state back to base layer\n');
}

testMagicBlock()
  .then(() => {
    console.log('✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`❌ Test failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
