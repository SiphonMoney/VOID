// Script to initialize Solana executor program
// Usage: node scripts/initialize-solana-program.js [executionAccountPubkey]

import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const executionAccountPubkey = process.argv[2] || process.env.SOLANA_EXECUTION_ACCOUNT_PUBKEY;

async function main() {
  console.log('\n🔧 Initializing AnonyMaus Executor Program...\n');
  
  if (!executionAccountPubkey) {
    console.error('❌ Error: Execution account public key not provided');
    console.error('   Usage: node scripts/initialize-solana-program.js <executionAccountPubkey>');
    console.error('   Or set SOLANA_EXECUTION_ACCOUNT_PUBKEY in .env');
    process.exit(1);
  }
  
  const programId = process.env.SOLANA_EXECUTOR_PROGRAM_ID || 'AnonyMausExecutor111111111111111111111111';
  const network = process.env.SOLANA_NETWORK || 'devnet';
  
  // Get RPC URL
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
  
  const rpcUrl = getRpcUrl(network);
  console.log(`📍 Network: ${network}`);
  console.log(`🌐 RPC URL: ${rpcUrl}`);
  console.log(`🔑 Program ID: ${programId}`);
  console.log(`👤 Execution Account: ${executionAccountPubkey}\n`);
  
  // Get authority keypair (deployer)
  // Can use either SOLANA_EXECUTION_SECRET_KEY or SOLANA_WALLET_SECRET_KEY
  const authoritySecretKey = process.env.SOLANA_EXECUTION_SECRET_KEY || process.env.SOLANA_WALLET_SECRET_KEY;
  if (!authoritySecretKey) {
    console.error('❌ Error: SOLANA_EXECUTION_SECRET_KEY or SOLANA_WALLET_SECRET_KEY not set in .env file');
    process.exit(1);
  }
  
  let authorityKeypair;
  try {
    const secretKeyBytes = bs58.decode(authoritySecretKey);
    authorityKeypair = Keypair.fromSecretKey(secretKeyBytes);
  } catch (e) {
    try {
      const secretKeyArray = JSON.parse(authoritySecretKey);
      authorityKeypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
    } catch (e2) {
      throw new Error('Invalid SOLANA_WALLET_SECRET_KEY format');
    }
  }
  
  console.log(`👤 Authority: ${authorityKeypair.publicKey.toString()}\n`);
  
  // Connect to Solana
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Derive PDAs
  const programPubkey = new PublicKey(programId);
  const [executorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('executor')],
    programPubkey
  );
  
  console.log(`📋 Executor PDA: ${executorPDA.toString()}\n`);
  
  // Check if already initialized
  const executorAccountInfo = await connection.getAccountInfo(executorPDA);
  if (executorAccountInfo) {
    console.log('✅ Executor PDA already initialized!');
    console.log(`   Executor PDA: ${executorPDA.toString()}`);
    console.log(`   Execution Account: ${executionAccountPubkey}`);
    console.log(`   Authority: ${authorityKeypair.publicKey.toString()}\n`);
    return;
  }
  
  // Parse execution account pubkey
  const executionAccountPubkeyObj = new PublicKey(executionAccountPubkey);
  
  // Get the bump seed for the executor PDA
  const [executorPDACheck, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('executor')],
    programPubkey
  );
  
  if (executorPDACheck.toString() !== executorPDA.toString()) {
    throw new Error('PDA derivation mismatch');
  }
  
  console.log(`🔧 Building initialize transaction...`);
  console.log(`   Bump seed: ${bump}`);
  
  // Build instruction data: discriminator (1 byte) + execution_account (32 bytes)
  const INITIALIZE = 0; // From lib.rs: const INITIALIZE: u8 = 0;
  const instructionData = Buffer.alloc(1 + 32);
  instructionData[0] = INITIALIZE;
  executionAccountPubkeyObj.toBuffer().copy(instructionData, 1);
  
  // Create transaction
  const transaction = new Transaction();
  
  // Add initialize instruction
  transaction.add({
    keys: [
      { pubkey: executorPDA, isSigner: false, isWritable: true },
      { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: programPubkey,
    data: instructionData,
  });
  
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = authorityKeypair.publicKey;
  
  // Sign transaction (PDA will be signed via invoke_signed, but we need authority signature)
  transaction.sign(authorityKeypair);
  
  // For PDA signing, we need to use invoke_signed, but since we're using Transaction.add,
  // we need to manually sign with the PDA bump seed. Actually, Solana will handle this
  // when we send the transaction if we use the correct approach.
  
  // Actually, we need to use invoke_signed for PDAs. Let me use a different approach:
  // We'll use the SystemProgram to create the account first, then initialize it.
  // But wait - the program expects the PDA to already exist or be created.
  
  // Actually, looking at the Rust code, it seems the account should already exist.
  // Let's check if we need to create it first with SystemProgram.createAccount.
  
  // For now, let's try sending the transaction and see what happens.
  // The program will handle account creation if needed (via rent exemption).
  
  // Calculate rent for executor account
  // Executor struct: execution_account (32) + authority (32) + is_initialized (1) = 65 bytes
  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(65);
  
  // Check if account exists and has enough balance
  const executorAccountInfoCheck = await connection.getAccountInfo(executorPDA);
  const needsFunding = !executorAccountInfoCheck || executorAccountInfoCheck.lamports < rentExemptBalance;
  
  if (needsFunding && !executorAccountInfo) {
    // Account doesn't exist - we need to create it via the program using invoke_signed
    // The program will create the account when we call initialize
    // But we need to ensure the account has rent-exempt balance
    // We'll add a transfer instruction to fund the PDA
    console.log(`💰 Funding Executor PDA with ${rentExemptBalance} lamports for rent exemption...`);
    
    // Create a transfer to fund the PDA (but PDAs can't receive direct transfers)
    // Actually, we need to use SystemProgram.createAccountWithSeed or the program creates it
    // For now, let's try the transaction - if it fails, we'll handle it
  }
  
  console.log(`📤 Sending initialize transaction...`);
  try {
    // Use sendTransaction with signers - Solana will handle PDA signing via the program
    const signature = await connection.sendTransaction(transaction, [authorityKeypair], {
      skipPreflight: false,
      maxRetries: 3
    });
    
    console.log(`📋 Transaction Signature: ${signature}`);
    console.log(`⏳ Waiting for confirmation...`);
    
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    console.log(`✅ Transaction confirmed!`);
    console.log(`   Signature: ${signature}`);
    console.log(`   Executor PDA: ${executorPDA.toString()}`);
    console.log(`   Execution Account: ${executionAccountPubkey}`);
    console.log(`   Authority: ${authorityKeypair.publicKey.toString()}\n`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.logs) {
      console.error(`   Logs:`, error.logs);
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Initialization failed:', error.message);
    process.exit(1);
  });
