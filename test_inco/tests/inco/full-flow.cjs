const path = require('path');
const crypto = require('crypto');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction
} = require('@solana/web3.js');
const { encryptValue } = require('@inco/solana-sdk/encryption');

const bs58Decode = bs58.decode ? bs58.decode : bs58.default.decode;
const bs58Encode = bs58.encode ? bs58.encode : bs58.default.encode;

require('dotenv').config({
  path:
    process.env.INCO_ENV_FILE ||
    path.join(__dirname, '..', '..', '..', 'sol_setup', '.env')
});

const rpcUrl =
  process.env.SOLANA_RPC_URL_DEVNET ||
  process.env.SOLANA_RPC_URL ||
  'https://api.devnet.solana.com';
const executorUrl = process.env.INCO_EXECUTOR_URL || 'http://127.0.0.1:8787';
const sendTx = process.env.INCO_SEND_TX === 'true';
const simulateTx = process.env.INCO_SIMULATE_TX === 'true';
const includeFullHandles = process.env.INCO_INCLUDE_FULL_HANDLES === 'true';
const secretKeyRaw = process.env.SOLANA_WALLET_SECRET_KEY;

const executorProgramId = new PublicKey(
  process.env.VOID_EXECUTOR_PROGRAM_ID || '11111111111111111111111111111111'
);

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadUserKeypair() {
  if (!secretKeyRaw) {
    throw new Error('Missing SOLANA_WALLET_SECRET_KEY in env');
  }

  return Keypair.fromSecretKey(
    secretKeyRaw.trim().startsWith('[')
      ? Uint8Array.from(JSON.parse(secretKeyRaw))
      : bs58Decode(secretKeyRaw)
  );
}

function signIntent(intent, userKeypair) {
  const intentBytes = Buffer.from(JSON.stringify(intent));
  const signature = nacl.sign.detached(intentBytes, userKeypair.secretKey);
  return {
    intentBytes,
    intentSignature: bs58Encode(signature)
  };
}

async function run() {
  console.log('✅ [IncoFlow] Starting full flow test');
  console.log(`ℹ️  [IncoFlow] RPC: ${rpcUrl}`);
  console.log(`ℹ️  [IncoFlow] Executor URL: ${executorUrl}`);
  console.log(`ℹ️  [IncoFlow] Simulate: ${simulateTx}`);
  console.log(`ℹ️  [IncoFlow] Send: ${sendTx}`);

  const connection = new Connection(rpcUrl, 'confirmed');
  const userKeypair = loadUserKeypair();

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), userKeypair.publicKey.toBuffer()],
    executorProgramId
  );

  console.log('\n🟢 [Step 1] Build plaintext intent values (client-side)');
  const amount = BigInt(1000);
  const threshold = BigInt(250);
  const guess = BigInt(42);
  const flag = true;

  console.log('🟢 [Step 2] Encrypt sensitive values with Inco');
  const encryptedAmount = await encryptValue(amount);
  const encryptedThreshold = await encryptValue(threshold);
  const encryptedGuess = await encryptValue(guess);
  const encryptedFlag = await encryptValue(flag);

  const encryptedHandles = includeFullHandles
    ? {
        amount: encryptedAmount,
        threshold: encryptedThreshold,
        guess: encryptedGuess,
        flag: encryptedFlag
      }
    : {
        amount: { hash: sha256Hex(encryptedAmount), bytes: encryptedAmount.length / 2 },
        threshold: { hash: sha256Hex(encryptedThreshold), bytes: encryptedThreshold.length / 2 },
        guess: { hash: sha256Hex(encryptedGuess), bytes: encryptedGuess.length / 2 },
        flag: { hash: sha256Hex(encryptedFlag), bytes: encryptedFlag.length / 2 }
      };

  console.log('🟢 [Step 3] Build intent payload (public metadata only)');
  const intent = {
    intent: 'swap',
    intentId: `intent-${Date.now()}`,
    encryptedHandles,
    publicMeta: {
      programId: executorProgramId.toBase58(),
      user: userKeypair.publicKey.toBase58(),
      vaultPda: vaultPda.toBase58(),
      nonce: 1,
      chain: 'solana-devnet'
    }
  };

  const intentHash = sha256Hex(JSON.stringify(intent));
  console.log(`ℹ️  [IncoFlow] Intent hash: ${intentHash}`);

  console.log('🟢 [Step 4] Sign intent (user-level signature)');
  const { intentBytes, intentSignature } = signIntent(intent, userKeypair);
  console.log('✍️  [IncoFlow] Intent signed');

  console.log('🟢 [Step 5] Send encrypted intent to mock executor');
  const response = await fetch(`${executorUrl}/intent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      intent,
      intentSignature,
      userPubkey: userKeypair.publicKey.toBase58()
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Executor error ${response.status}: ${text}`);
  }

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Executor rejected intent: ${payload.error || 'unknown'}`);
  }

  console.log(`✅ [IncoFlow] Executor ok (txSize: ${payload.txSize})`);

  console.log('🟢 [Step 6] Receive executor-built tx (memo contains encrypted handles)');
  const txBytes = Buffer.from(payload.txBase64, 'base64');
  const tx = Transaction.from(txBytes);

  if (simulateTx) {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      console.warn('⚠️  [IncoFlow] Simulation error', sim.value.err);
    } else {
      console.log('🧪 [IncoFlow] Simulation ok');
    }
  }

  if (sendTx) {
    const signature = await connection.sendRawTransaction(txBytes);
    console.log(`📤 [IncoFlow] Sent tx: ${signature}`);
  }

  console.log('✅ [IncoFlow] Full flow complete');
}

run().catch((error) => {
  console.error('❌ [IncoFlow] Failed:', error);
  process.exit(1);
});
