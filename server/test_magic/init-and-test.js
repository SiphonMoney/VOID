// Initialize counter and test full flow

import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const BASE_RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
const connection = new Connection(BASE_RPC, 'confirmed');

const PROGRAM_ID = new PublicKey('3XBN19JZQfDngF9VXDZzpzx32Q8GWXU3xrC3mvEdedom');
const INITIALIZE = 0;
const INCREMENT = 1;
const GET_VALUE = 2;

async function initAndTest() {
  console.log('\n🚀 Initialize and Test Counter Program\n');

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

  console.log(`✅ Payer: ${payerKeypair.publicKey.toBase58()}`);
  console.log(`✅ Program: ${PROGRAM_ID.toBase58()}\n`);

  // Derive counter PDA
  const [counterPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('counter')],
    PROGRAM_ID
  );

  console.log(`📋 Counter PDA: ${counterPDA.toBase58()}`);
  console.log(`   Bump: ${bump}\n`);

  // Check if already initialized
  const counterInfo = await connection.getAccountInfo(counterPDA);
  if (counterInfo) {
    console.log('✅ Counter account already exists\n');
    if (counterInfo.data.length >= 8) {
      // Read u64 as two u32s and combine, or use BigInt
      const low = counterInfo.data.readUInt32LE(0);
      const high = counterInfo.data.readUInt32LE(4);
      const value = BigInt(low) + (BigInt(high) << 32n);
      console.log(`📊 Current value: ${value}\n`);
    }
  } else {
    console.log('🔨 Initializing counter account (program will create it)...\n');

    // Program will create the account via CPI
    const tx = new Transaction().add({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: counterPDA, isSigner: false, isWritable: true },
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([INITIALIZE]),
    });

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair], {
        commitment: 'confirmed',
        skipPreflight: false,
      });
      console.log(`✅ Initialization transaction: ${sig}\n`);
      console.log(`📊 Counter initialized to 0\n`);
    } catch (error) {
      console.error(`❌ Initialization failed: ${error.message}\n`);
      throw error;
    }
  }

  // Test increment
  console.log('🧪 Testing increment...\n');
  
  const incrementTx = new Transaction().add({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: counterPDA, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([INCREMENT]),
  });

  try {
    const sig = await sendAndConfirmTransaction(connection, incrementTx, [payerKeypair], {
      commitment: 'confirmed',
      skipPreflight: false,
    });
    console.log(`✅ Increment transaction: ${sig}\n`);

    // Read new value
    const info = await connection.getAccountInfo(counterPDA);
    if (info && info.data.length >= 8) {
      const low = info.data.readUInt32LE(0);
      const high = info.data.readUInt32LE(4);
      const value = BigInt(low) + (BigInt(high) << 32n);
      console.log(`📊 New counter value: ${value}\n`);
    }
  } catch (error) {
    console.error(`❌ Increment failed: ${error.message}\n`);
    console.error('   This might be because counter account needs initialization first\n');
  }

  console.log('✅ Test completed!\n');
}

initAndTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
