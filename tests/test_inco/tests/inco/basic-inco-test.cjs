const path = require('path');
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction
} = require('@solana/web3.js');
const bs58 = require('bs58');
const bs58Decode = bs58.decode ? bs58.decode : bs58.default.decode;
const crypto = require('crypto');
const { encryptValue } = require('@inco/solana-sdk/encryption');

require('dotenv').config({
  path:
    process.env.INCO_ENV_FILE ||
    path.join(__dirname, '..', '..', '..', 'sol_setup', '.env')
});

const iterations = Number(process.env.INCO_TEST_ITERATIONS || 1);
const rpcUrl =
  process.env.SOLANA_RPC_URL_DEVNET ||
  process.env.SOLANA_RPC_URL ||
  'https://api.devnet.solana.com';
const sendTx = process.env.INCO_SEND_TX === 'true';
const simulateTx = process.env.INCO_SIMULATE_TX === 'true';
const skipSign = process.env.INCO_SKIP_SIGN === 'true';
const secretKeyRaw = process.env.SOLANA_WALLET_SECRET_KEY;
const includeFullHandles = process.env.INCO_INCLUDE_FULL_HANDLES === 'true';
const executorProgramId = new PublicKey(
  process.env.VOID_EXECUTOR_PROGRAM_ID || '11111111111111111111111111111111'
);
const memoProgramId = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function run() {
  console.log('✅ [IncoTest] Inco encryption ready');
  console.log(`ℹ️  [IncoTest] Iterations: ${iterations}`);
  console.log(`ℹ️  [IncoTest] RPC: ${rpcUrl}`);
  console.log(`ℹ️  [IncoTest] Send tx: ${sendTx}`);
  console.log(`ℹ️  [IncoTest] Simulate tx: ${simulateTx}`);

  const connection = new Connection(rpcUrl, 'confirmed');
  const payer = secretKeyRaw
    ? Keypair.fromSecretKey(
        secretKeyRaw.trim().startsWith('[')
          ? Uint8Array.from(JSON.parse(secretKeyRaw))
          : bs58Decode(secretKeyRaw)
      )
    : Keypair.generate();

  console.log(`ℹ️  [IncoTest] Signer: ${payer.publicKey.toBase58()}`);

  const results = [];

  for (let i = 0; i < iterations; i += 1) {
    console.log(`\n🟢 [IncoTest] Iteration ${i + 1} start`);

    // Step 1: plaintext intent values (never sent on-chain)
    const amount = BigInt(1 + i);
    const threshold = BigInt(1);
    const guess = BigInt(42 + i);
    const flag = i % 2 === 0;

    // Step 2: encrypt before transaction creation
    const encryptedAmount = await encryptValue(amount);
    const encryptedThreshold = await encryptValue(threshold);
    const encryptedGuess = await encryptValue(guess);
    const encryptedFlag = await encryptValue(flag);

    console.log(
      `🔐 [IncoTest] Encrypted (${i + 1}) amount bytes: ${encryptedAmount.length / 2}`
    );
    console.log(
      `🔐 [IncoTest] Encrypted (${i + 1}) threshold bytes: ${encryptedThreshold.length / 2}`
    );
    console.log(
      `🔐 [IncoTest] Encrypted (${i + 1}) guess bytes: ${encryptedGuess.length / 2}`
    );
    console.log(
      `🔐 [IncoTest] Encrypted (${i + 1}) flag bytes: ${encryptedFlag.length / 2}`
    );

    // Step 3: build public metadata + accounts (no plaintext)
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), payer.publicKey.toBuffer()],
      executorProgramId
    );

    const intent = {
      intent: 'swap',
      intentId: `intent-${Date.now()}-${i + 1}`,
      encryptedHandles: includeFullHandles
        ? {
            amount: encryptedAmount,
            threshold: encryptedThreshold,
            guess: encryptedGuess,
            flag: encryptedFlag
          }
        : {
            amount: {
              hash: crypto.createHash('sha256').update(encryptedAmount).digest('hex'),
              bytes: encryptedAmount.length / 2
            },
            threshold: {
              hash: crypto.createHash('sha256').update(encryptedThreshold).digest('hex'),
              bytes: encryptedThreshold.length / 2
            },
            guess: {
              hash: crypto.createHash('sha256').update(encryptedGuess).digest('hex'),
              bytes: encryptedGuess.length / 2
            },
            flag: {
              hash: crypto.createHash('sha256').update(encryptedFlag).digest('hex'),
              bytes: encryptedFlag.length / 2
            }
          },
      publicMeta: {
        programId: executorProgramId.toBase58(),
        user: payer.publicKey.toBase58(),
        vaultPda: vaultPda.toBase58(),
        nonce: i + 1
      }
    };

    const memoPayload = JSON.stringify(intent);

    const memoIx = new TransactionInstruction({
      programId: memoProgramId,
      keys: [],
      data: Buffer.from(memoPayload)
    });

    // Step 4: assemble tx with encrypted handles
    const tx = new Transaction().add(memoIx);

    if (!skipSign) {
      // Sign after encryption and intent assembly
      tx.feePayer = payer.publicKey;
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.sign(payer);
      console.log(`✍️  [IncoTest] Signed tx (${i + 1})`);
    }

    let serialized = null;
    try {
      serialized = tx.serialize({ requireAllSignatures: false });
      console.log(`📦 [IncoTest] Tx size: ${serialized.length} bytes`);
    } catch (error) {
      console.warn('⚠️  [IncoTest] Tx serialization failed', error?.message || error);
    }

    if (simulateTx) {
      if (skipSign || !serialized) {
        console.warn('⚠️  [IncoTest] Simulation skipped (tx not signed)');
      } else {
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err) {
          console.warn('⚠️  [IncoTest] Simulation error', sim.value.err);
        } else {
          console.log('🧪 [IncoTest] Simulation ok');
        }
      }
    }

    if (sendTx) {
      const balance = await connection.getBalance(payer.publicKey, 'confirmed');
      if (!serialized) {
        console.warn('⚠️  [IncoTest] Send skipped (tx too large)');
      } else if (balance === 0) {
        console.warn('⚠️  [IncoTest] Balance is 0; skipping send');
      } else {
        const signature = await connection.sendRawTransaction(serialized);
        console.log(`📤 [IncoTest] Sent tx (${i + 1}): ${signature}`);
      }
    }

    results.push({
      iteration: i + 1,
      amountHex: encryptedAmount,
      thresholdHex: encryptedThreshold,
      guessHex: encryptedGuess,
      flagHex: encryptedFlag,
      vaultPda: vaultPda.toBase58()
    });
  }

  console.log('✅ [IncoTest] Test loop complete');
}

run().catch((error) => {
  console.error('❌ [IncoTest] Test failed:', error);
  process.exit(1);
});
