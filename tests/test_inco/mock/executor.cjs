const path = require('path');
const express = require('express');
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const bs58 = require('bs58');
const nacl = require('tweetnacl');

const bs58Decode = bs58.decode ? bs58.decode : bs58.default.decode;

require('dotenv').config({
  path:
    process.env.INCO_ENV_FILE ||
    path.join(__dirname, '..', '..', 'sol_setup', '.env')
});

const app = express();
app.use(express.json({ limit: '256kb' }));

const basePort = Number(process.env.INCO_EXECUTOR_PORT || 8787);
const rpcUrl =
  process.env.SOLANA_RPC_URL_DEVNET ||
  process.env.SOLANA_RPC_URL ||
  'https://api.devnet.solana.com';
const memoProgramId = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const connection = new Connection(rpcUrl, 'confirmed');
const executorKeypair = process.env.INCO_EXECUTOR_SECRET_KEY
  ? Keypair.fromSecretKey(
      process.env.INCO_EXECUTOR_SECRET_KEY.trim().startsWith('[')
        ? Uint8Array.from(JSON.parse(process.env.INCO_EXECUTOR_SECRET_KEY))
        : bs58Decode(process.env.INCO_EXECUTOR_SECRET_KEY)
    )
  : Keypair.generate();

const executorProgramId = new PublicKey(
  process.env.VOID_EXECUTOR_PROGRAM_ID || '11111111111111111111111111111111'
);

function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, executor: executorKeypair.publicKey.toBase58() });
});

app.post('/intent', async (req, res) => {
  const { intent, intentSignature, userPubkey } = req.body || {};

  if (!intent || !intentSignature || !userPubkey) {
    return badRequest(res, 'Missing intent, intentSignature, or userPubkey');
  }

  try {
    const userKey = new PublicKey(userPubkey);
    const intentBytes = Buffer.from(JSON.stringify(intent));
    const sigBytes = bs58Decode(intentSignature);

    const verified = nacl.sign.detached.verify(
      new Uint8Array(intentBytes),
      new Uint8Array(sigBytes),
      userKey.toBytes()
    );

    if (!verified) {
      return badRequest(res, 'Invalid intent signature');
    }

    const memoIx = new TransactionInstruction({
      programId: memoProgramId,
      keys: [],
      data: intentBytes
    });

    const tx = new Transaction().add(memoIx);
    tx.feePayer = executorKeypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.sign(executorKeypair);

    const serialized = tx.serialize();
    const txSize = serialized.length;

    if (txSize > 1232) {
      return badRequest(res, `Transaction too large: ${txSize} > 1232`);
    }

    res.json({
      ok: true,
      executor: executorKeypair.publicKey.toBase58(),
      programId: executorProgramId.toBase58(),
      txSize,
      txBase64: serialized.toString('base64')
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

function startServer(port, remainingAttempts = 5) {
  const server = app.listen(port, () => {
    console.log(`✅ [MockExecutor] Listening on http://127.0.0.1:${port}`);
    console.log(`ℹ️  [MockExecutor] RPC: ${rpcUrl}`);
    console.log(`ℹ️  [MockExecutor] Executor: ${executorKeypair.publicKey.toBase58()}`);
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE' && remainingAttempts > 0) {
      const nextPort = port + 1;
      console.warn(`⚠️  [MockExecutor] Port ${port} in use, trying ${nextPort}...`);
      startServer(nextPort, remainingAttempts - 1);
      return;
    }

    console.error('❌ [MockExecutor] Server failed to start:', error?.message || error);
    process.exit(1);
  });
}

startServer(basePort);
