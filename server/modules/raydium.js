import {
  Liquidity,
  LIQUIDITY_STATE_LAYOUT_V4,
  MARKET_STATE_LAYOUT_V3,
  Token,
  TokenAmount,
  Percent
} from '@raydium-io/raydium-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  getMint,
  AccountLayout
} from '@solana/spl-token';

const RAYDIUM_LIQUIDITY_PROGRAM_ID = new PublicKey(
  'RVKd61ztZW9GUwhRbbLoYVRE5Xf9B2t3sc6qwfqE3zH'
);
const SERUM_DEX_PROGRAM_ID = new PublicKey(
  'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY'
);

async function getProgramAccountsWithFallback(connection, filters) {
  try {
    return await connection.getProgramAccounts(
      RAYDIUM_LIQUIDITY_PROGRAM_ID,
      { filters }
    );
  } catch (error) {
    const message = error?.message || String(error);
    if (!message.includes('getProgramAccounts')) {
      throw error;
    }
    const fallbackRpc = process.env.SOLANA_RPC_URL_DEVNET_FALLBACK || 'https://api.devnet.solana.com';
    const fallbackConnection = new Connection(fallbackRpc, 'confirmed');
    return await fallbackConnection.getProgramAccounts(
      RAYDIUM_LIQUIDITY_PROGRAM_ID,
      { filters }
    );
  }
}

async function buildPoolKeysFromId(connection, poolId) {
  const poolAccount = await connection.getAccountInfo(poolId);
  if (!poolAccount) {
    throw new Error('Raydium pool account not found');
  }
  const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
  const marketAccountInfo = await connection.getAccountInfo(poolState.marketId);
  if (!marketAccountInfo) {
    throw new Error('Raydium market account not found');
  }
  const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [poolState.marketId.toBuffer()],
    SERUM_DEX_PROGRAM_ID
  );
  return {
    id: poolId,
    baseMint: poolState.baseMint,
    quoteMint: poolState.quoteMint,
    lpMint: poolState.lpMint,
    baseDecimals: poolState.baseDecimal.toNumber(),
    quoteDecimals: poolState.quoteDecimal.toNumber(),
    lpDecimals: poolState.lpDecimal.toNumber(),
    version: 4,
    programId: RAYDIUM_LIQUIDITY_PROGRAM_ID,
    authority: poolState.authority,
    openOrders: poolState.openOrders,
    targetOrders: poolState.targetOrders,
    baseVault: poolState.baseVault,
    quoteVault: poolState.quoteVault,
    marketProgramId: SERUM_DEX_PROGRAM_ID,
    marketId: poolState.marketId,
    marketAuthority,
    marketBaseVault: marketState.baseVault,
    marketQuoteVault: marketState.quoteVault,
    marketBids: marketState.bids,
    marketAsks: marketState.asks,
    marketEventQueue: marketState.eventQueue
  };
}

async function findRaydiumPool(connection, mintA, mintB) {
  const filtersFor = (base, quote) => ([
    { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
    {
      memcmp: {
        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
        bytes: base.toBase58()
      }
    },
    {
      memcmp: {
        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
        bytes: quote.toBase58()
      }
    }
  ]);

  const search = async (base, quote) => {
    const accounts = await getProgramAccountsWithFallback(
      connection,
      filtersFor(base, quote)
    );
    if (accounts.length === 0) return null;
    return accounts[0];
  };

  return (await search(mintA, mintB)) || (await search(mintB, mintA));
}

async function buildPoolKeys(connection, poolAccount) {
  const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.account.data);
  const marketAccountInfo = await connection.getAccountInfo(poolState.marketId);
  if (!marketAccountInfo) {
    throw new Error('Raydium market account not found');
  }

  const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [poolState.marketId.toBuffer()],
    SERUM_DEX_PROGRAM_ID
  );

  return {
    id: poolAccount.pubkey,
    baseMint: poolState.baseMint,
    quoteMint: poolState.quoteMint,
    lpMint: poolState.lpMint,
    baseDecimals: poolState.baseDecimal.toNumber(),
    quoteDecimals: poolState.quoteDecimal.toNumber(),
    lpDecimals: poolState.lpDecimal.toNumber(),
    version: 4,
    programId: RAYDIUM_LIQUIDITY_PROGRAM_ID,
    authority: poolState.authority,
    openOrders: poolState.openOrders,
    targetOrders: poolState.targetOrders,
    baseVault: poolState.baseVault,
    quoteVault: poolState.quoteVault,
    marketProgramId: SERUM_DEX_PROGRAM_ID,
    marketId: poolState.marketId,
    marketAuthority,
    marketBaseVault: marketState.baseVault,
    marketQuoteVault: marketState.quoteVault,
    marketBids: marketState.bids,
    marketAsks: marketState.asks,
    marketEventQueue: marketState.eventQueue
  };
}

async function getOrCreateAtaInstruction(connection, payer, owner, mint) {
  const ata = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
  try {
    await getAccount(connection, ata);
    return { ata, instruction: null };
  } catch (_) {
    return {
      ata,
      instruction: createAssociatedTokenAccountInstruction(
        payer,
        ata,
        owner,
        mint
      )
    };
  }
}

export async function buildRaydiumSwapInstructions({
  connection,
  owner,
  payer,
  mintIn,
  mintOut,
  amountIn,
  slippage,
  poolId
}) {
  let poolKeys = null;
  if (poolId) {
    poolKeys = await buildPoolKeysFromId(connection, new PublicKey(poolId));
  } else {
    const poolAccount = await findRaydiumPool(connection, mintIn, mintOut);
    if (!poolAccount) {
      throw new Error('Raydium pool not found for mint pair');
    }
    poolKeys = await buildPoolKeys(connection, poolAccount);
  }
  const mintInInfo = await getMint(connection, mintIn);
  const mintOutInfo = await getMint(connection, mintOut);

  const tokenIn = new Token(TOKEN_PROGRAM_ID, mintIn, mintInInfo.decimals);
  const tokenOut = new Token(TOKEN_PROGRAM_ID, mintOut, mintOutInfo.decimals);

  // Convert amountIn to string safely, handling BigInt and large numbers
  // TokenAmount expects amount in raw token units (e.g., lamports for SOL)
  let amountInString;
  if (typeof amountIn === 'bigint') {
    amountInString = amountIn.toString();
  } else if (typeof amountIn === 'number') {
    // If it's a number, ensure it's within safe integer range
    if (amountIn > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Amount ${amountIn} exceeds safe integer limit. Use BigInt instead.`);
    }
    amountInString = amountIn.toString();
  } else {
    amountInString = String(amountIn);
  }

  const amountInToken = new TokenAmount(tokenIn, amountInString, false);
  const slippagePct = new Percent(Math.round(slippage * 10000), 10000);

  const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
  const { minAmountOut } = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn: amountInToken,
    currencyOut: tokenOut,
    slippage: slippagePct
  });

  const tokenAccounts = await connection.getTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID
  });
  const userTokenAccounts = tokenAccounts.value.map((acc) => ({
    pubkey: acc.pubkey,
    programId: TOKEN_PROGRAM_ID,
    accountInfo: AccountLayout.decode(acc.account.data)
  }));

  const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
    connection,
    poolKeys,
    userKeys: {
      tokenAccounts: userTokenAccounts,
      owner
    },
    amountIn: amountInToken,
    amountOut: minAmountOut,
    fixedSide: 'in',
    makeTxVersion: 0,
    computeBudgetConfig: { units: 200000, microLamports: 1 }
  });

  const instructions = [];
  const signers = [];

  for (const inner of innerTransactions) {
    if (inner.instructionTypes?.includes('openOrder') && inner.signers?.length) {
      signers.push(...inner.signers);
    }
    instructions.push(...inner.instructions);
  }

  return { instructions, signers, poolKeys };
}

export async function prepareExecutorAccounts({
  connection,
  payer,
  owner,
  mintIn,
  mintOut,
  amountIn
}) {
  const instructions = [];

  const { ata: inAta, instruction: inCreate } = await getOrCreateAtaInstruction(
    connection,
    payer,
    owner,
    mintIn
  );
  if (inCreate) instructions.push(inCreate);

  const { ata: outAta, instruction: outCreate } = await getOrCreateAtaInstruction(
    connection,
    payer,
    owner,
    mintOut
  );
  if (outCreate) instructions.push(outCreate);

  return { instructions, inAta, outAta };
}
