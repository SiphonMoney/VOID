// Deploy and initialize test program

import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
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

async function deployAndInitialize() {
  console.log('\n🚀 Deploying and Initializing Test Program\n');

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

  // Check if program is already deployed
  // In real deployment, you would:
  // 1. Generate program keypair: solana-keygen new -o target/deploy/test_magic-keypair.json
  // 2. Build: cargo build-sbf
  // 3. Deploy: solana program deploy target/deploy/test_magic.so --program-id target/deploy/test_magic-keypair.json

  console.log('📝 Deployment steps:');
  console.log('   1. Generate program keypair:');
  console.log('      solana-keygen new -o target/deploy/test_magic-keypair.json\n');
  console.log('   2. Build program:');
  console.log('      cargo build-sbf --manifest-path=Cargo.toml\n');
  console.log('   3. Deploy program:');
  console.log('      solana program deploy target/deploy/test_magic.so \\');
  console.log('        --program-id target/deploy/test_magic-keypair.json \\');
  console.log('        --url devnet\n');
  console.log('   4. Update PROGRAM_ID in test scripts\n');
  console.log('   5. Run initialization:\n');

  // Example initialization (commented out - needs actual program ID)
  /*
  const PROGRAM_ID = new PublicKey('YOUR_DEPLOYED_PROGRAM_ID');
  const [counterPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('counter')],
    PROGRAM_ID
  );

  const rent = await connection.getMinimumBalanceForRentExemption(8);
  
  const initTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payerKeypair.publicKey,
      newAccountPubkey: counterPDA,
      lamports: rent,
      space: 8,
      programId: PROGRAM_ID,
    }),
    // Initialize instruction
    {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: counterPDA, isSigner: false, isWritable: true },
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([0]), // INITIALIZE
    }
  );

  const sig = await connection.sendTransaction(initTx, [payerKeypair]);
  console.log(`✅ Initialization: ${sig}`);
  */
}

deployAndInitialize()
  .then(() => {
    console.log('✅ Instructions printed');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  });
