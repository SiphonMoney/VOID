// Swap Executor Module
// Handles executing Raydium swaps with executor accounts

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import {
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import { prepareExecutorAccounts } from './raydium.js';
import { buildRaydiumSwapInstructionsV2 } from './raydium-v2.js';
import { log } from './logger.js';
import { executeOnPER, getPERConnection } from './magicblock.js';

const RAYDIUM_PROGRAM_IDS = [
  'RVKd61ztZW9GUwhRbbLoYVRE5Xf9B2t3sc6qwfqE3zH', // CLMM devnet
  'DRaybByLpbUL57LJARs3j8BitTxVfzBg351EaMr5UTCd', // Raydium Router
  'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb', // Raydium Pool Program
].map((id) => new PublicKey(id));

const WRAPPER_EXECUTE_RAYDIUM_SWAP = 4;

function getExecutorProgramId() {
  const programId = process.env.SOLANA_EXECUTOR_PROGRAM_ID;
  return programId ? new PublicKey(programId) : null;
}

function buildWrapperInstruction({
  executorPda,
  authority,
  raydiumIx,
  executorProgramId,
}) {
  const ixData = Buffer.alloc(1 + 4 + raydiumIx.data.length);
  ixData[0] = WRAPPER_EXECUTE_RAYDIUM_SWAP;
  ixData.writeUInt32LE(raydiumIx.data.length, 1);
  raydiumIx.data.copy(ixData, 5);

  return new TransactionInstruction({
    programId: executorProgramId,
    keys: [
      { pubkey: executorPda, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: raydiumIx.programId, isSigner: false, isWritable: false },
      ...raydiumIx.keys.map((key) => ({
        pubkey: key.pubkey,
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
    ],
    data: ixData,
  });
}

/**
 * Execute a Raydium swap transaction
 */
export async function executeSwap({
  connection,
  executionKeypair,
  mintIn,
  mintOut,
  amountIn,
  slippage,
  poolId,
  userPubkey,
  transactionData = null,
  usePER = false, // Use MagicBlock PER for execution
}) {
  // 1. Prepare executor token accounts
  const { instructions: ataInstructions, inAta, outAta } = await prepareExecutorAccounts({
    connection,
    payer: executionKeypair.publicKey,
    owner: executionKeypair.publicKey,
    mintIn,
    mintOut,
    amountIn,
  });

  // 2. Build swap transaction
  const swapTx = new Transaction();
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  swapTx.recentBlockhash = blockhash;
  swapTx.feePayer = executionKeypair.publicKey;

  // Add ATA creation instructions if needed
  if (ataInstructions.length > 0) {
    swapTx.add(...ataInstructions);
  }

  // Wrap SOL if input is native
  if (mintIn.equals(NATIVE_MINT)) {
    // Handle BigInt amounts - SystemProgram.transfer accepts number | bigint
    // Convert to Number if it fits in safe integer range, otherwise pass as BigInt
    let lamportsValue;
    if (typeof amountIn === 'bigint') {
      if (amountIn > BigInt(Number.MAX_SAFE_INTEGER)) {
        // Amount exceeds safe integer range - pass as BigInt (web3.js supports this)
        lamportsValue = amountIn;
      } else {
        lamportsValue = Number(amountIn);
      }
    } else {
      lamportsValue = amountIn;
    }
    swapTx.add(
      SystemProgram.transfer({
        fromPubkey: executionKeypair.publicKey,
        toPubkey: inAta,
        lamports: lamportsValue,
      })
    );
    swapTx.add(createSyncNativeInstruction(inAta));
  }

  // 3. Build swap instructions
  let swapInstructions, signers;
  try {
    const result = await buildRaydiumSwapInstructionsV2({
      connection,
      owner: executionKeypair, // Pass Keypair
      mintIn,
      mintOut,
      amountIn,
      slippage,
      poolId,
    });
    swapInstructions = result.instructions;
    signers = result.signers || [];
  } catch (swapError) {
    // Handle fallback for routed swaps or extraction
    const isRoutedSwap =
      swapError.message.includes('Route') ||
      (transactionData?.serialized &&
        transactionData.serialized.includes('DRaybByLpbUL57LJARs3j8BitTxVfzBg351EaMr5UTCd'));

    if (isRoutedSwap) {
      log(`⚠️ Routed swap detected - retrying with SDK using poolId: ${poolId}`, 'warn');
      try {
        const result = await buildRaydiumSwapInstructionsV2({
          connection,
          owner: executionKeypair,
          mintIn,
          mintOut,
          amountIn,
          slippage,
          poolId,
        });
        swapInstructions = result.instructions;
        signers = result.signers || [];
        log(`✅ Successfully built swap instructions with SDK (retry)`, 'success');
      } catch (retryError) {
        log(`❌ SDK retry also failed: ${retryError.message}`, 'error');
        throw new Error(
          `Failed to build swap instructions: ${swapError.message}. Retry also failed: ${retryError.message}`
        );
      }
    } else {
      throw swapError;
    }
  }

  // 4. Validate instructions
  if (!swapInstructions || swapInstructions.length === 0) {
    throw new Error('No swap instructions to execute');
  }

  log(`📋 Validating ${swapInstructions.length} swap instruction(s)...`, 'info');
  for (let i = 0; i < swapInstructions.length; i++) {
    const ix = swapInstructions[i];
    if (!ix.programId) {
      throw new Error(`Instruction ${i} missing programId`);
    }
    if (!ix.keys || !Array.isArray(ix.keys)) {
      throw new Error(`Instruction ${i} missing or invalid keys`);
    }
    if (!ix.data) {
      throw new Error(`Instruction ${i} missing data`);
    }
    log(`   Instruction ${i + 1}: Program ${ix.programId.toBase58()}, ${ix.keys.length} accounts, ${ix.data.length} bytes`, 'info');
  }

  // 5. Add swap instructions to transaction
  const useWrapper = usePER && process.env.USE_PER_WRAPPER !== 'false';

  if (useWrapper) {
    const executorProgramId = getExecutorProgramId();
    if (!executorProgramId) {
      throw new Error('SOLANA_EXECUTOR_PROGRAM_ID is required for PER wrapper execution');
    }

    const raydiumIx = swapInstructions.find((ix) =>
      RAYDIUM_PROGRAM_IDS.some((id) => id.equals(ix.programId))
    );

    if (!raydiumIx) {
      throw new Error('No Raydium instruction found to wrap');
    }

    const [executorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('executor')],
      executorProgramId
    );

    const wrapperIx = buildWrapperInstruction({
      executorPda,
      authority: executionKeypair.publicKey,
      raydiumIx,
      executorProgramId,
    });

    const wrappedInstructions = swapInstructions.map((ix) =>
      ix === raydiumIx ? wrapperIx : ix
    );

    swapTx.add(...wrappedInstructions);
    log('✅ Wrapped Raydium swap instruction with PER wrapper', 'success');
  } else {
    swapTx.add(...swapInstructions);
  }

  // 6. Sign and send transaction
  swapTx.sign(executionKeypair, ...signers);

  let swapSignature;
  let executionConnection = connection;

  if (usePER) {
    // Execute on MagicBlock PER - required, no fallback
    log('🚀 Executing swap on MagicBlock PER...', 'info');
    
    const perResult = await executeOnPER(swapTx, executionKeypair, connection, log);
    swapSignature = perResult.signature;
    executionConnection = await getPERConnection(executionKeypair, log);
    log(`✅ Swap transaction executed on PER: ${swapSignature}`, 'success');
    log(`🔗 Explorer: https://explorer.solana.com/tx/${swapSignature}?cluster=devnet`, 'info');
  } else {
    // Execute on base layer
    try {
      // Serialize transaction - this may fail if SDK built instructions with numbers > MAX_SAFE_INTEGER
      const serializedTx = swapTx.serialize();
      swapSignature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: false,
        maxRetries: 3,
      });
      log(`✅ Swap transaction submitted: ${swapSignature}`, 'success');
      log(`🔗 Explorer: https://explorer.solana.com/tx/${swapSignature}?cluster=devnet`, 'info');
    } catch (serializeError) {
      if (serializeError.message && (serializeError.message.includes('53 bits') || serializeError.message.includes('safe integer') || serializeError.message.includes('Number can only'))) {
        throw new Error(`Transaction serialization failed: The Raydium SDK built instructions with amounts exceeding JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}). This usually happens with very large swap amounts. Original error: ${serializeError.message}`);
      }
      throw serializeError;
    }
  }

  // 7. Wait for confirmation with robust polling (blockhash confirmation often fails due to expiration)
  // Use status polling as primary method - more reliable on devnet
  log(`⏳ Waiting for transaction confirmation...`, 'info');
  
  let confirmed = false;
  let transactionFailed = false;
  const maxAttempts = 20; // 40 seconds total (20 * 2s)
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const status = await executionConnection.getSignatureStatus(swapSignature);
      
      if (status?.value) {
        // Check for errors first
        if (status.value.err) {
          transactionFailed = true;
          log(`❌ Transaction failed: ${JSON.stringify(status.value.err)}`, 'error');
          throw new Error(`Swap transaction failed: ${JSON.stringify(status.value.err)}`);
        }
        
        // Check confirmation status
        const confirmationStatus = status.value.confirmationStatus;
        if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
          confirmed = true;
          log(`✅ Swap transaction confirmed (${confirmationStatus})`, 'success');
          break;
        }
        
        // Log progress every 5 attempts
        if ((i + 1) % 5 === 0) {
          log(`⏳ Still waiting for confirmation... (attempt ${i + 1}/${maxAttempts}, status: ${confirmationStatus || 'pending'})`, 'info');
        }
      } else {
        // Status not available yet - transaction might still be processing
        if ((i + 1) % 5 === 0) {
          log(`⏳ Transaction status not available yet... (attempt ${i + 1}/${maxAttempts})`, 'info');
        }
      }
    } catch (statusError) {
      // If it's a transaction failure, re-throw
      if (transactionFailed) {
        throw statusError;
      }
      // Otherwise, log and continue polling
      if ((i + 1) % 5 === 0) {
        log(`⚠️ Error checking status (attempt ${i + 1}/${maxAttempts}): ${statusError.message}`, 'warn');
      }
    }
  }
  
  // Final status check
  if (!confirmed && !transactionFailed) {
    try {
      const finalStatus = await executionConnection.getSignatureStatus(swapSignature);
      if (finalStatus?.value?.err) {
        log(`❌ Transaction failed: ${JSON.stringify(finalStatus.value.err)}`, 'error');
        throw new Error(`Swap transaction failed: ${JSON.stringify(finalStatus.value.err)}`);
      }
      if (finalStatus?.value?.confirmationStatus === 'confirmed' || finalStatus?.value?.confirmationStatus === 'finalized') {
        confirmed = true;
        log(`✅ Swap transaction confirmed (final check)`, 'success');
      } else {
        log(`⚠️ Confirmation timeout after ${maxAttempts} attempts. Transaction may have succeeded - check explorer.`, 'warn');
        log(`   Signature: ${swapSignature}`, 'info');
      }
    } catch (finalError) {
      log(`⚠️ Final status check failed: ${finalError.message}`, 'warn');
    }
  }

  return {
    signature: swapSignature,
    inAta,
    outAta,
  };
}

/**
 * Transfer swap output tokens to user
 */
export async function transferSwapOutput({
  connection,
  executionKeypair,
  mintOut,
  outAta,
  userPubkey,
}) {
  if (mintOut.equals(NATIVE_MINT)) {
    // Close WSOL account and send SOL to user
    const closeTx = new Transaction();
    closeTx.add(
      createCloseAccountInstruction(
        outAta,
        userPubkey,
        executionKeypair.publicKey
      )
    );
    const { blockhash: closeBlockhash } = await connection.getLatestBlockhash('confirmed');
    closeTx.recentBlockhash = closeBlockhash;
    closeTx.feePayer = executionKeypair.publicKey;
    closeTx.sign(executionKeypair);
    const closeSig = await connection.sendRawTransaction(closeTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    log(`✅ Closed WSOL account to user: ${closeSig}`, 'success');
    return closeSig;
  } else {
    // Transfer tokens to user's ATA
    const userOutAta = await getAssociatedTokenAddress(mintOut, userPubkey, false);
    const userOutInfo = await connection.getAccountInfo(userOutAta);
    const transferTx = new Transaction();

    if (!userOutInfo) {
      transferTx.add(
        createAssociatedTokenAccountInstruction(
          executionKeypair.publicKey,
          userOutAta,
          userPubkey,
          mintOut
        )
      );
    }

    const outBalance = await connection.getTokenAccountBalance(outAta);
    const outAmount = BigInt(outBalance.value.amount || '0');

    if (outAmount > 0n) {
      transferTx.add(
        createTransferInstruction(
          outAta,
          userOutAta,
          executionKeypair.publicKey,
          outAmount
        )
      );
    }

    const { blockhash: transferBlockhash } = await connection.getLatestBlockhash('confirmed');
    transferTx.recentBlockhash = transferBlockhash;
    transferTx.feePayer = executionKeypair.publicKey;
    transferTx.sign(executionKeypair);
    const transferSig = await connection.sendRawTransaction(transferTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    log(`✅ Output transfer submitted: ${transferSig}`, 'success');
    return transferSig;
  }
}
