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

// Helper function to safely convert BN to Number (decimals should always be small)
function safeBNToNumber(bn, defaultValue = 0) {
  // Handle undefined/null values FIRST - before any property access
  if (bn === undefined || bn === null) {
    console.warn(`⚠️ [Raydium] BN value is undefined/null, using default ${defaultValue}`);
    return defaultValue;
  }
  
  // Check if it's already a number
  if (typeof bn === 'number') {
    return bn;
  }
  
  // Check if bn is an object before accessing properties
  if (typeof bn !== 'object') {
    console.warn(`⚠️ [Raydium] Value is not an object (type: ${typeof bn}), attempting conversion. Value: ${bn}`);
    try {
      const num = Number(bn);
      if (isNaN(num)) {
        console.warn(`⚠️ [Raydium] Cannot convert to number, using default ${defaultValue}`);
        return defaultValue;
      }
      return num;
    } catch (e) {
      console.warn(`⚠️ [Raydium] Error converting to number: ${e.message}, using default ${defaultValue}`);
      return defaultValue;
    }
  }
  
  // Now safe to check for BN methods
  const hasGt = typeof bn.gt === 'function';
  const hasToNumber = typeof bn.toNumber === 'function';
  
  if (!hasGt || !hasToNumber) {
    console.warn(`⚠️ [Raydium] Value is not a BN object (has gt: ${hasGt}, has toNumber: ${hasToNumber}), attempting conversion. Type: ${typeof bn}, Value: ${bn}`);
    try {
      const num = Number(bn);
      if (isNaN(num)) {
        console.warn(`⚠️ [Raydium] Cannot convert to number, using default ${defaultValue}`);
        return defaultValue;
      }
      return num;
    } catch (e) {
      console.warn(`⚠️ [Raydium] Error converting to number: ${e.message}, using default ${defaultValue}`);
      return defaultValue;
    }
  }
  
  try {
    // Decimals are typically 0-18, so they should always fit in safe integer range
    // But BN.toNumber() throws if the value exceeds safe integer limit
    const MAX_SAFE = Number.MAX_SAFE_INTEGER;
    if (bn.gt(MAX_SAFE)) {
      console.warn(`⚠️ [Raydium] BN value ${bn.toString()} exceeds safe integer limit, using default ${defaultValue}`);
      return defaultValue;
    }
    return bn.toNumber();
  } catch (error) {
    if (error.message && error.message.includes('53 bits')) {
      console.warn(`⚠️ [Raydium] BN.toNumber() failed for value ${bn?.toString() || 'undefined'}, using default ${defaultValue}`);
      return defaultValue;
    }
    throw error;
  }
}

async function buildPoolKeysFromId(connection, poolId) {
  const poolAccount = await connection.getAccountInfo(poolId);
  if (!poolAccount) {
    throw new Error('Raydium pool account not found');
  }
  // Ensure this is an AMM v4 pool account (Raydium SDK v1 expects this)
  if (!poolAccount.owner?.equals(RAYDIUM_LIQUIDITY_PROGRAM_ID)) {
    throw new Error(
      `Pool account owner ${poolAccount.owner?.toBase58?.() || poolAccount.owner} is not Raydium AMM v4 (${RAYDIUM_LIQUIDITY_PROGRAM_ID.toBase58()}). ` +
      `This pool is likely CLMM/CPMM and is not supported by raydium-sdk v1.`
    );
  }
  // Ensure account data length matches expected AMM v4 layout
  if (poolAccount.data?.length !== LIQUIDITY_STATE_LAYOUT_V4.span) {
    throw new Error(
      `Pool account data length ${poolAccount.data?.length} does not match AMM v4 layout (${LIQUIDITY_STATE_LAYOUT_V4.span}). ` +
      `This pool is likely CLMM/CPMM and is not supported by raydium-sdk v1.`
    );
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
  
  // Get decimals from mint accounts instead of pool state (pool state decimals may be incorrectly decoded)
  let baseDecimals = 9; // Default for SOL
  let quoteDecimals = 6; // Default for USDC
  let lpDecimals = 9; // Default
  
  try {
    const baseMintInfo = await getMint(connection, poolState.baseMint);
    baseDecimals = baseMintInfo.decimals;
  } catch (e) {
    console.warn(`⚠️ [Raydium] Failed to get base mint decimals, using default 9: ${e.message}`);
  }
  
  try {
    const quoteMintInfo = await getMint(connection, poolState.quoteMint);
    quoteDecimals = quoteMintInfo.decimals;
  } catch (e) {
    console.warn(`⚠️ [Raydium] Failed to get quote mint decimals, using default 6: ${e.message}`);
  }
  
  try {
    const lpMintInfo = await getMint(connection, poolState.lpMint);
    lpDecimals = lpMintInfo.decimals;
  } catch (e) {
    console.warn(`⚠️ [Raydium] Failed to get LP mint decimals, using default 9: ${e.message}`);
  }
  
  console.log(`[Raydium] Using decimals from mint accounts - base: ${baseDecimals}, quote: ${quoteDecimals}, lp: ${lpDecimals}`);
  
  return {
    id: poolId,
    baseMint: poolState.baseMint,
    quoteMint: poolState.quoteMint,
    lpMint: poolState.lpMint,
    baseDecimals,
    quoteDecimals,
    lpDecimals,
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

  // Get decimals from mint accounts instead of pool state
  let baseDecimals = 9;
  let quoteDecimals = 6;
  let lpDecimals = 9;
  
  try {
    const baseMintInfo = await getMint(connection, poolState.baseMint);
    baseDecimals = baseMintInfo.decimals;
  } catch (e) {
    console.warn(`⚠️ [Raydium] Failed to get base mint decimals, using default 9`);
  }
  
  try {
    const quoteMintInfo = await getMint(connection, poolState.quoteMint);
    quoteDecimals = quoteMintInfo.decimals;
  } catch (e) {
    console.warn(`⚠️ [Raydium] Failed to get quote mint decimals, using default 6`);
  }
  
  try {
    const lpMintInfo = await getMint(connection, poolState.lpMint);
    lpDecimals = lpMintInfo.decimals;
  } catch (e) {
    console.warn(`⚠️ [Raydium] Failed to get LP mint decimals, using default 9`);
  }

  return {
    id: poolAccount.pubkey,
    baseMint: poolState.baseMint,
    quoteMint: poolState.quoteMint,
    lpMint: poolState.lpMint,
    baseDecimals,
    quoteDecimals,
    lpDecimals,
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
    try {
      poolKeys = await buildPoolKeysFromId(connection, new PublicKey(poolId));
    } catch (error) {
      console.warn(`⚠️ [Raydium] Failed to use poolId ${poolId}: ${error.message}`);
      console.warn('⚠️ [Raydium] Falling back to AMM v4 pool discovery by mint pair');
      const poolAccount = await findRaydiumPool(connection, mintIn, mintOut);
      if (!poolAccount) {
        throw new Error(
          `No AMM v4 pool found for the mint pair. ` +
          `The provided poolId may be CLMM/CPMM (unsupported by raydium-sdk v1).`
        );
      }
      poolKeys = await buildPoolKeys(connection, poolAccount);
    }
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
  // CRITICAL: The Raydium SDK V1 internally converts amounts to Number, which fails for values > 2^53-1
  // We must cap the amount at MAX_SAFE_INTEGER to prevent SDK errors
  let amountInString;
  let amountInBigInt;
  
  if (typeof amountIn === 'bigint') {
    amountInBigInt = amountIn;
  } else if (typeof amountIn === 'number') {
    amountInBigInt = BigInt(Math.floor(amountIn));
  } else {
    // Try to parse as BigInt
    try {
      amountInBigInt = BigInt(String(amountIn));
    } catch (e) {
      throw new Error(`Invalid amount format: ${amountIn}`);
    }
  }
  
  // CRITICAL FIX: Cap amount at MAX_SAFE_INTEGER to prevent SDK Number conversion errors
  // The Raydium SDK V1 internally converts amounts to Number, which fails for values > 2^53-1
  const MAX_SAFE_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
  const originalAmount = amountInBigInt;
  if (amountInBigInt > MAX_SAFE_AMOUNT) {
    const originalAmountStr = originalAmount.toString();
    const maxSafeStr = MAX_SAFE_AMOUNT.toString();
    console.warn(`⚠️ [Raydium] Amount ${originalAmountStr} exceeds safe integer limit (${maxSafeStr}). Capping to maximum safe value to prevent SDK Number conversion error.`);
    amountInBigInt = MAX_SAFE_AMOUNT;
  }
  
  amountInString = amountInBigInt.toString();
  console.log(`[Raydium] Using amount: ${amountInString} (original: ${originalAmount.toString()}, capped: ${amountInBigInt !== originalAmount})`);
  
  // Validate that the string representation is valid
  if (amountInString === 'NaN' || amountInString === 'Infinity' || amountInString === '-Infinity' || amountInBigInt <= 0n) {
    throw new Error(`Invalid amount: ${amountInString}`);
  }

  // Create TokenAmount with the capped amount to prevent SDK Number conversion errors
  let amountInToken;
  try {
    amountInToken = new TokenAmount(tokenIn, amountInString, false);
  } catch (error) {
    if (error.message && (error.message.includes('53 bits') || error.message.includes('safe integer') || error.message.includes('Number can only'))) {
      throw new Error(`TokenAmount creation failed: Amount ${amountInString} exceeds safe integer limit. This should not happen after capping. Original error: ${error.message}`);
    }
    throw error;
  }

  const slippagePct = new Percent(Math.round(slippage * 10000), 10000);

  const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
  let minAmountOut;
  try {
    console.log(`[Raydium] Computing amount out with amountInToken: ${amountInToken.toFixed()}, slippage: ${slippagePct.toFixed()}`);
    const computeResult = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn: amountInToken,
      currencyOut: tokenOut,
      slippage: slippagePct
    });
    minAmountOut = computeResult.minAmountOut;
    console.log(`[Raydium] Computed minAmountOut: ${minAmountOut.toFixed()}`);
  } catch (error) {
    console.error(`[Raydium] Error in computeAmountOut:`, error);
    if (error.message && (error.message.includes('53 bits') || error.message.includes('safe integer') || error.message.includes('Number can only'))) {
      throw new Error(`Amount calculation failed: Amount ${amountInString} exceeds safe integer limit. The Raydium SDK may not support amounts this large. Original error: ${error.message}`);
    }
    throw error;
  }

  // Ensure owner is a PublicKey (handle both Keypair and PublicKey)
  const ownerPubkey = owner.publicKey ? owner.publicKey : owner;
  
  const tokenAccounts = await connection.getTokenAccountsByOwner(ownerPubkey, {
    programId: TOKEN_PROGRAM_ID
  });
  const userTokenAccounts = tokenAccounts.value.map((acc) => ({
    pubkey: acc.pubkey,
    programId: TOKEN_PROGRAM_ID,
    accountInfo: AccountLayout.decode(acc.account.data)
  }));

  console.log(`[Raydium] Found ${userTokenAccounts.length} token accounts for owner ${ownerPubkey.toString()}`);
  console.log(`[Raydium] Pool keys:`, {
    id: poolKeys.id.toString(),
    baseMint: poolKeys.baseMint.toString(),
    quoteMint: poolKeys.quoteMint.toString(),
    baseDecimals: poolKeys.baseDecimals,
    quoteDecimals: poolKeys.quoteDecimals
  });

  let innerTransactions;
  try {
    console.log(`[Raydium] Building swap instructions with amountIn: ${amountInToken.toFixed()}, minAmountOut: ${minAmountOut.toFixed()}`);
    console.log(`[Raydium] Pool keys structure:`, JSON.stringify({
      id: poolKeys.id.toString(),
      baseMint: poolKeys.baseMint.toString(),
      quoteMint: poolKeys.quoteMint.toString(),
      version: poolKeys.version
    }, null, 2));
    
    const swapResult = await Liquidity.makeSwapInstructionSimple({
      connection,
      poolKeys,
      userKeys: {
        tokenAccounts: userTokenAccounts,
        owner: ownerPubkey
      },
      amountIn: amountInToken,
      amountOut: minAmountOut,
      fixedSide: 'in',
      makeTxVersion: 0,
      computeBudgetConfig: { units: 200000, microLamports: 10000 } // Increased from 1 to 10000 for proper priority fee
    });
    
    console.log(`[Raydium] Swap result:`, {
      hasInnerTransactions: !!swapResult.innerTransactions,
      innerTransactionsLength: swapResult.innerTransactions?.length || 0,
      innerTransactions: swapResult.innerTransactions
    });
    
    innerTransactions = swapResult.innerTransactions;
    
    if (!innerTransactions || innerTransactions.length === 0) {
      throw new Error('Raydium SDK returned no instructions. This may indicate invalid pool keys, insufficient liquidity, or SDK compatibility issue.');
    }
    
    console.log(`[Raydium] Built ${innerTransactions.length} inner transactions`);
  } catch (error) {
    console.error(`[Raydium] Error in makeSwapInstructionSimple:`, error);
    console.error(`[Raydium] Error stack:`, error.stack);
    if (error.message && (error.message.includes('53 bits') || error.message.includes('safe integer') || error.message.includes('Number can only'))) {
      throw new Error(`Raydium SDK error: Amount ${amountInString} (${amountInBigInt.toString()} raw) exceeds JavaScript's safe integer limit. The SDK cannot handle amounts larger than ${Number.MAX_SAFE_INTEGER}. Original error: ${error.message}`);
    }
    throw error;
  }

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
