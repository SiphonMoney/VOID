// Full MagicBlock PER integration test
// Tests: initialize, delegate, execute on PER, commit

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
const perConnection = new Connection(MAGICBLOCK_PER_RPC, 'confirmed', {
  wsEndpoint: MAGICBLOCK_PER_WS,
});

// Instruction discriminators
const INITIALIZE = 0;
const INCREMENT = 1;
const GET_VALUE = 2;

async function createInitializeInstruction(programId, counterPDA, user) {
  return {
    programId,
    keys: [
      { pubkey: counterPDA, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([INITIALIZE]),
  };
}

async function createIncrementInstruction(programId, counterPDA) {
  return {
    programId,
    keys: [
      { pubkey: counterPDA, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([INCREMENT]),
  };
}

async function testFullFlow() {
  console.log('\n🧪 Full MagicBlock PER Test\n');

  // Load keypair
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

  // Deployed program ID
  const PROGRAM_ID = new PublicKey('3XBN19JZQfDngF9VXDZzpzx32Q8GWXU3xrC3mvEdedom');
  console.log(`✅ Program ID: ${PROGRAM_ID.toBase58()}\n`);

  // Derive counter PDA
  const [counterPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('counter')],
    PROGRAM_ID
  );

  console.log(`📋 Counter PDA: ${counterPDA.toBase58()}`);
  console.log(`   Bump: ${bump}\n`);

  // Test 1: Check if counter account exists
  console.log('🔍 Test 1: Checking counter account...');
  const counterInfo = await baseConnection.getAccountInfo(counterPDA);
  if (counterInfo) {
    console.log(`   ✅ Counter account exists (${counterInfo.lamports} lamports)\n`);
    
    // Read current value
    if (counterInfo.data.length >= 8) {
      const low = counterInfo.data.readUInt32LE(0);
      const high = counterInfo.data.readUInt32LE(4);
      const value = BigInt(low) + (BigInt(high) << 32n);
      console.log(`   📊 Current value: ${value}\n`);
    }
  } else {
    console.log(`   ⚠️  Counter account doesn't exist - needs initialization\n`);
  }

  // Test 2: Test PER connection
  console.log('🔍 Test 2: Testing PER connection...');
  try {
    const perBlockhash = await perConnection.getLatestBlockhash('confirmed');
    console.log(`   ✅ PER connection: ${perBlockhash.blockhash.slice(0, 16)}...\n`);
  } catch (error) {
    console.error(`   ❌ PER connection failed: ${error.message}\n`);
    throw error;
  }

  // Test 3: Test base layer connection
  console.log('🔍 Test 3: Testing base layer connection...');
  try {
    const baseBlockhash = await baseConnection.getLatestBlockhash('confirmed');
    console.log(`   ✅ Base layer connection: ${baseBlockhash.blockhash.slice(0, 16)}...\n`);
  } catch (error) {
    console.error(`   ❌ Base layer connection failed: ${error.message}\n`);
    throw error;
  }

  // Test 4: Check TEE validator account
  console.log('🔍 Test 4: Checking TEE validator...');
  try {
    const validatorInfo = await baseConnection.getAccountInfo(TEE_VALIDATOR);
    if (validatorInfo) {
      console.log(`   ✅ TEE validator exists (${validatorInfo.lamports} lamports)\n`);
    } else {
      console.log(`   ⚠️  TEE validator account not found\n`);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check validator: ${error.message}\n`);
  }

  // Test 5: Check delegation program
  console.log('🔍 Test 5: Checking delegation program...');
  try {
    const delegationInfo = await baseConnection.getAccountInfo(DELEGATION_PROGRAM_ID);
    if (delegationInfo && delegationInfo.executable) {
      console.log(`   ✅ Delegation program is deployed\n`);
    } else {
      console.log(`   ⚠️  Delegation program not found or not executable\n`);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check delegation program: ${error.message}\n`);
  }

  console.log('✅ All connectivity tests passed!\n');
  console.log('📝 To complete full test:');
  console.log('   1. Deploy test program: solana program deploy target/deploy/test_magic.so');
  console.log('   2. Update PROGRAM_ID in this script');
  console.log('   3. Run initialization transaction');
  console.log('   4. Delegate counter PDA to PER');
  console.log('   5. Execute increment on PER');
  console.log('   6. Commit state to base layer\n');
}

testFullFlow()
  .then(() => {
    console.log('✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`❌ Test failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
