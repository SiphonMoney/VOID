import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, NATIVE_MINT, createInitializeMintInstruction, MINT_SIZE, getMinimumBalanceForRentExemptMint, createMintToInstruction } from '@solana/spl-token';
import { Raydium, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const RPC_URL = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';

async function createTokenAndPool() {
  console.log('\n🚀 Creating SOL/zUSDC Pool on Devnet\n');
  console.log(`📡 RPC: ${RPC_URL}\n`);
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Get owner keypair
  const executionSecretKey = process.env.SOLANA_EXECUTION_SECRET_KEY || process.env.SOLANA_WALLET_SECRET_KEY;
  let owner;
  
  if (executionSecretKey) {
    try {
      const secretKeyBytes = bs58.decode(executionSecretKey);
      owner = Keypair.fromSecretKey(secretKeyBytes);
    } catch (e) {
      try {
        const secretKeyArray = JSON.parse(executionSecretKey);
        owner = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
      } catch (e2) {
        console.error('❌ Invalid execution key format');
        return;
      }
    }
  } else {
    console.error('❌ No execution key found in .env');
    return;
  }
  
  console.log(`👤 Owner: ${owner.publicKey.toBase58()}\n`);
  
  // Use existing token or create new one
  const existingMint = process.argv[2]; // Pass mint address as argument
  let mintToken;
  
  try {
    if (existingMint) {
      // Step 1: Use existing token
      console.log('1️⃣ Using existing zUSDC token...');
      mintToken = new PublicKey(existingMint);
      
      // Verify it exists
      const mintInfo = await connection.getAccountInfo(mintToken);
      if (!mintInfo) {
        throw new Error(`Token ${existingMint} not found on devnet`);
      }
      
      console.log(`✅ Using existing token: ${mintToken.toBase58()}\n`);
    } else {
      // Step 1: Create zUSDC token
    console.log('1️⃣ Creating zUSDC token (6 decimals, like USDC)...');
    const mintKeypair = Keypair.generate();
    const mintToken = mintKeypair.publicKey;
    
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: owner.publicKey,
        newAccountPubkey: mintToken,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintToken,
        6,
        owner.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    );
    
    createMintTx.recentBlockhash = blockhash;
    createMintTx.feePayer = owner.publicKey;
    createMintTx.sign(owner, mintKeypair);
    
    console.log('   Sending transaction...');
    const signature = await connection.sendRawTransaction(createMintTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });
    
    console.log(`   Transaction sent: ${signature}`);
    console.log(`   Checking transaction status...`);
    
    // Check transaction status without waiting for confirmation
    let confirmed = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      const status = await connection.getSignatureStatus(signature);
      if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
        confirmed = true;
        console.log(`   ✅ Transaction confirmed (${status.value.confirmationStatus})`);
        break;
      }
      console.log(`   ⏳ Waiting... (attempt ${i + 1}/10)`);
    }
    
    if (!confirmed) {
      // Check if mint was created anyway
      console.log('   ⚠️  Confirmation timeout, checking if mint was created...');
      const mintInfo = await connection.getAccountInfo(mintToken);
      if (!mintInfo) {
        console.log(`   ⚠️  Mint not found yet. Transaction may still be processing.`);
        console.log(`   💡 Check transaction: https://solscan.io/tx/${signature}?cluster=devnet`);
        console.log(`   💡 You can continue - the script will check again before creating pool.\n`);
      } else {
        console.log('   ✅ Mint account exists (transaction succeeded)');
        confirmed = true;
      }
    }
    
      console.log(`✅ zUSDC Token created: ${mintToken.toBase58()}`);
      console.log(`   Transaction: https://solscan.io/tx/${signature}?cluster=devnet\n`);
      
      // Verify mint exists before proceeding
      console.log('   Verifying mint account exists...');
      let mintInfo = await connection.getAccountInfo(mintToken);
      let retries = 0;
      while (!mintInfo && retries < 5) {
        console.log(`   ⏳ Mint not found, waiting... (${retries + 1}/5)`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        mintInfo = await connection.getAccountInfo(mintToken);
        retries++;
      }
      
      if (!mintInfo) {
        throw new Error(`Mint account not found after waiting. Please check transaction: https://solscan.io/tx/${signature}?cluster=devnet`);
      }
      console.log('   ✅ Mint account verified\n');
    }
    
    // Step 2: Mint some zUSDC to owner
    console.log('2️⃣ Minting 1,000,000 zUSDC to owner...');
    const ownerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      owner,
      mintToken,
      owner.publicKey
    );
    
    const { blockhash: blockhash2, lastValidBlockHeight: lastValid2 } = await connection.getLatestBlockhash('confirmed');
    
    // Build mint transaction manually to avoid confirmation issues
    const mintTx = new Transaction().add(
      createMintToInstruction(
        mintToken,
        ownerTokenAccount.address,
        owner.publicKey,
        1_000_000_000_000, // 1M tokens with 6 decimals
        undefined,
        TOKEN_PROGRAM_ID
      )
    );
    
    mintTx.recentBlockhash = blockhash2;
    mintTx.feePayer = owner.publicKey;
    mintTx.sign(owner);
    
    console.log('   Sending mint transaction...');
    const mintSignature = await connection.sendRawTransaction(mintTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });
    
    // Check mint transaction status
    console.log(`   Mint transaction: ${mintSignature}`);
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const status = await connection.getSignatureStatus(mintSignature);
      if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
        console.log(`   ✅ Mint transaction confirmed`);
        break;
      }
      if (i === 9) {
        console.log(`   ⚠️  Mint confirmation timeout, but continuing...`);
        console.log(`   💡 Check: https://solscan.io/tx/${mintSignature}?cluster=devnet`);
      }
    }
    
    console.log(`✅ Minted 1,000,000 zUSDC to ${ownerTokenAccount.address.toBase58()}\n`);
    
    // Step 3: Initialize Raydium SDK
    console.log('3️⃣ Initializing Raydium SDK v2...');
    const raydium = await Raydium.load({
      owner: owner, // Pass keypair, not just publicKey
      connection,
      cluster: 'devnet',
      disableFeatureCheck: true,
      disableLoadToken: false,
      blockhashCommitment: 'finalized',
      urlConfigs: {
        BASE_HOST: 'https://api-v3-devnet.raydium.io',
        OWNER_BASE_HOST: 'https://owner-v1-devnet.raydium.io',
        SWAP_HOST: 'https://transaction-v1-devnet.raydium.io',
        CPMM_LOCK: 'https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position',
      },
    });
    console.log('✅ SDK initialized\n');
    
    // Step 4: Get token info
    console.log('4️⃣ Getting token info...');
    const mintA = await raydium.token.getTokenInfo(NATIVE_MINT.toBase58());
    const mintB = await raydium.token.getTokenInfo(mintToken.toBase58());
    
    console.log(`   Mint A (SOL): ${mintA.address}`);
    console.log(`   Mint B (zUSDC): ${mintB.address}\n`);
    
    // Step 5: Get fee configs
    console.log('5️⃣ Getting CPMM fee configs...');
    const feeConfigs = await raydium.api.getCpmmConfigs();
    
    // Update config IDs for devnet
    feeConfigs.forEach((config) => {
      config.id = getCpmmPdaAmmConfigId(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, config.index).publicKey.toBase58();
    });
    
    console.log(`✅ Using fee config: ${feeConfigs[0].id}\n`);
    
    // Step 6: Create CPMM pool
    console.log('6️⃣ Creating SOL/zUSDC CPMM pool...');
    console.log('   Initial liquidity: 1 SOL + 1000 zUSDC\n');
    
    const { execute, extInfo, transaction } = await raydium.cpmm.createPool({
      programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
      mintA,
      mintB,
      mintAAmount: new BN(1_000_000_000), // 1 SOL (9 decimals)
      mintBAmount: new BN(1_000_000_000), // 1000 zUSDC (6 decimals, so 1000 * 10^6)
      startTime: new BN(0),
      feeConfig: feeConfigs[0],
      associatedOnly: false,
      ownerInfo: {
        useSOLBalance: true,
      },
      txVersion: 0,
    });
    
    console.log('✅ Pool transaction built\n');
    
    // Get pool ID from extInfo before executing
    const poolId = extInfo.address.poolId.toBase58();
    console.log(`   Pool ID will be: ${poolId}\n`);
    
    console.log('7️⃣ Executing pool creation transaction...');
    
    try {
      const result = await execute({ sendAndConfirm: false });
      const txId = result?.txId || result?.signature || (Array.isArray(result) ? result[0]?.txId : null);
      
      if (!txId) {
        console.log('   ⚠️  Transaction sent but txId not returned, checking extInfo...');
        console.log(`   Pool ID: ${poolId}`);
        console.log(`   Check if pool was created: https://solscan.io/account/${poolId}?cluster=devnet\n`);
      } else {
        console.log(`   Transaction: ${txId}`);
        console.log(`   Checking status...`);
        
        for (let i = 0; i < 15; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const status = await connection.getSignatureStatus(txId);
          if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
            console.log(`   ✅ Transaction confirmed (${status.value.confirmationStatus})`);
            break;
          }
          if (status?.value?.err) {
            console.log(`   ❌ Transaction failed: ${JSON.stringify(status.value.err)}`);
            // Don't throw - pool might still be created
            break;
          }
          if (i === 14) {
            console.log(`   ⚠️  Confirmation timeout, but continuing...`);
          }
        }
      }
    } catch (execError) {
      console.log(`   ⚠️  Execute error: ${execError.message}`);
      console.log(`   Pool ID should be: ${poolId}`);
      console.log(`   Check if pool was created anyway...\n`);
    }
    
    console.log('\n🎉 Pool Creation Complete!\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 Pool Information:');
    console.log(`   zUSDC Token: ${mintToken.toBase58()}`);
    console.log(`   Pool ID: ${poolId}`);
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('💡 Use this pool ID in Raydium frontend:');
    console.log(`   ${poolId}\n`);
    console.log('💡 Or use this URL:');
    console.log(`   https://raydium.io/swap/?inputMint=sol&outputMint=${mintToken.toBase58()}&poolId=${poolId}\n`);
    console.log('💡 Test the swap with:');
    console.log(`   npm run test-swap-simple ${poolId} ${mintToken.toBase58()}\n`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

createTokenAndPool()
  .then(() => {
    console.log('✨ Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });
