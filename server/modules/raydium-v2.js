import {
  Raydium,
  TxVersion,
  DEV_API_URLS,
  PoolUtils,
  CurveCalculator,
  FeeOn,
  ALL_PROGRAM_ID,
  DEVNET_PROGRAM_ID,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';

function getProgramIdsForCluster(cluster) {
  return cluster === 'devnet' ? DEVNET_PROGRAM_ID : ALL_PROGRAM_ID;
}

const raydiumCache = new Map();

function detectCluster(rpcEndpoint) {
  if (!rpcEndpoint) return 'devnet';
  return rpcEndpoint.includes('devnet') ? 'devnet' : 'mainnet';
}

async function initRaydiumV2(connection, owner) {
  const cacheKey = `${connection.rpcEndpoint}:${owner.publicKey.toBase58()}`;
  if (raydiumCache.has(cacheKey)) {
    return raydiumCache.get(cacheKey);
  }

  const cluster = detectCluster(connection.rpcEndpoint);
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: 'confirmed',
    ...(cluster === 'devnet'
      ? {
          urlConfigs: {
            ...DEV_API_URLS,
            BASE_HOST: 'https://api-v3-devnet.raydium.io',
            OWNER_BASE_HOST: 'https://owner-v1-devnet.raydium.io',
            SWAP_HOST: 'https://transaction-v1-devnet.raydium.io',
            CPMM_LOCK: 'https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position',
          },
        }
      : {}),
  });

  raydiumCache.set(cacheKey, raydium);
  return raydium;
}

function getPoolTypeByOwner(programId, programIds) {
  const ownerStr = programId?.toBase58?.() || String(programId);
  if (ownerStr === programIds.CLMM_PROGRAM_ID.toBase58()) return 'clmm';
  if (ownerStr === programIds.CREATE_CPMM_POOL_PROGRAM.toBase58()) return 'cpmm';
  if (ownerStr === programIds.AMM_V4.toBase58() || ownerStr === programIds.AMM_STABLE.toBase58()) {
    return 'amm';
  }
  return 'unknown';
}

function getPoolTypeByProgramId(programId, programIds) {
  if (!programId) return 'unknown';
  const programIdStr = programId.toString();
  if (programIdStr === programIds.CLMM_PROGRAM_ID.toBase58()) return 'clmm';
  if (programIdStr === programIds.CREATE_CPMM_POOL_PROGRAM.toBase58()) return 'cpmm';
  if (programIdStr === programIds.AMM_V4.toBase58() || programIdStr === programIds.AMM_STABLE.toBase58()) {
    return 'amm';
  }
  return 'unknown';
}

function extractInstructionsFromTransaction(transaction) {
  if (!transaction) {
    throw new Error('No transaction returned from Raydium SDK v2');
  }
  if (transaction.instructions && Array.isArray(transaction.instructions)) {
    return transaction.instructions;
  }
  if (transaction.message?.instructions && Array.isArray(transaction.message.instructions)) {
    return transaction.message.instructions;
  }
  throw new Error('Unable to extract instructions from Raydium v2 transaction');
}

export async function buildRaydiumSwapInstructionsV2({
  connection,
  owner,
  mintIn,
  mintOut,
  amountIn,
  slippage,
  poolId,
}) {
  if (!poolId) {
    throw new Error('Raydium v2 requires poolId for CLMM/CPMM swaps');
  }

  const raydium = await initRaydiumV2(connection, owner);
  const poolIdPk = new PublicKey(poolId);
  const poolAccountInfo = await connection.getAccountInfo(poolIdPk);

  if (!poolAccountInfo?.owner) {
    throw new Error(`Pool account ${poolId} not found or has no owner`);
  }

  const cluster = detectCluster(connection.rpcEndpoint);
  const programIds = getProgramIdsForCluster(cluster);
  let poolType = getPoolTypeByOwner(poolAccountInfo.owner, programIds);

  // Try Raydium API to identify pool type when available
  try {
    const apiResult = await raydium.api.fetchPoolById({ ids: poolId });
    const apiPool = Array.isArray(apiResult) ? apiResult[0] : null;
    if (apiPool?.programId) {
      const apiType = getPoolTypeByProgramId(apiPool.programId, programIds);
      if (apiType !== 'unknown') {
        poolType = apiType;
      }
    }
  } catch (e) {
    // API may not be available on devnet; ignore
  }

  console.log(
    `[Raydium v2] Pool owner: ${poolAccountInfo.owner.toBase58()}, cluster: ${cluster}, poolType: ${poolType}`
  );
  if (poolType === 'unknown') {
    throw new Error(
      `Unsupported pool program owner ${poolAccountInfo.owner.toBase58()} for pool ${poolId}. ` +
      `Expected CLMM (${programIds.CLMM_PROGRAM_ID.toBase58()}), ` +
      `CPMM (${programIds.CREATE_CPMM_POOL_PROGRAM.toBase58()}), or AMM (${programIds.AMM_V4.toBase58()}).`
    );
  }
  const inputAmount = new BN(amountIn.toString());
  const inputMintStr = mintIn.toBase58();

  if (poolType === 'clmm') {
    const data = await raydium.clmm.getPoolInfoFromRpc(poolId);
    const poolInfo = data.poolInfo;
    const poolKeys = data.poolKeys;
    const clmmPoolInfo = data.computePoolInfo;
    const tickCache = data.tickData;

    if (
      inputMintStr !== poolInfo.mintA.address &&
      inputMintStr !== poolInfo.mintB.address
    ) {
      throw new Error('Input mint does not match CLMM pool');
    }

    const baseIn = inputMintStr === poolInfo.mintA.address;
    const { minAmountOut, remainingAccounts } = await PoolUtils.computeAmountOutFormat({
      poolInfo: clmmPoolInfo,
      tickArrayCache: tickCache[poolId],
      amountIn: inputAmount,
      tokenOut: poolInfo[baseIn ? 'mintB' : 'mintA'],
      slippage,
      epochInfo: await raydium.fetchEpochInfo(),
    });

    const { transaction } = await raydium.clmm.swap({
      poolInfo,
      poolKeys,
      inputMint: poolInfo[baseIn ? 'mintA' : 'mintB'].address,
      amountIn: inputAmount,
      amountOutMin: minAmountOut.amount.raw,
      observationId: clmmPoolInfo.observationId,
      ownerInfo: {
        useSOLBalance: true,
      },
      remainingAccounts,
      txVersion: TxVersion.LEGACY,
    });

    return { instructions: extractInstructionsFromTransaction(transaction), signers: [] };
  }

  if (poolType === 'cpmm') {
    let data;
    try {
      data = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    } catch (error) {
      if (error.message?.includes('fetch vault info error')) {
        throw new Error(
          `CPMM pool vaults not found for ${poolId}. This usually means the poolId is not CPMM on ${cluster}.`
        );
      }
      throw error;
    }
    const poolInfo = data.poolInfo;
    const poolKeys = data.poolKeys;
    const rpcData = data.rpcData;

    if (
      inputMintStr !== poolInfo.mintA.address &&
      inputMintStr !== poolInfo.mintB.address
    ) {
      throw new Error('Input mint does not match CPMM pool');
    }

    const baseIn = inputMintStr === poolInfo.mintA.address;
    const swapResult = CurveCalculator.swapBaseInput(
      inputAmount,
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      rpcData.configInfo?.tradeFeeRate,
      rpcData.configInfo?.creatorFeeRate,
      rpcData.configInfo?.protocolFeeRate,
      rpcData.configInfo?.fundFeeRate,
      rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB
    );

    const { transaction } = await raydium.cpmm.swap({
      poolInfo,
      poolKeys,
      inputAmount,
      swapResult,
      slippage,
      baseIn,
      txVersion: TxVersion.LEGACY,
    });

    return { instructions: extractInstructionsFromTransaction(transaction), signers: [] };
  }

  const data = await raydium.liquidity.getPoolInfoFromRpc({ poolId });
  const poolInfo = data.poolInfo;
  const poolKeys = data.poolKeys;
  const rpcData = data.poolRpcData;
  const baseReserve = rpcData.baseReserve;
  const quoteReserve = rpcData.quoteReserve;
  const status = rpcData.status.toNumber();

  if (
    inputMintStr !== poolInfo.mintA.address &&
    inputMintStr !== poolInfo.mintB.address
  ) {
    throw new Error('Input mint does not match AMM pool');
  }

  const baseIn = inputMintStr === poolInfo.mintA.address;
  const mintInAddr = baseIn ? poolInfo.mintA.address : poolInfo.mintB.address;
  const mintOutAddr = baseIn ? poolInfo.mintB.address : poolInfo.mintA.address;

  const out = raydium.liquidity.computeAmountOut({
    poolInfo: {
      ...poolInfo,
      baseReserve,
      quoteReserve,
      status,
      version: 4,
    },
    amountIn: inputAmount,
    mintIn: mintInAddr,
    mintOut: mintOutAddr,
    slippage,
  });

  const { transaction } = await raydium.liquidity.swap({
    poolInfo,
    poolKeys,
    amountIn: inputAmount,
    amountOut: out.minAmountOut,
    fixedSide: 'in',
    inputMint: mintInAddr,
    txVersion: TxVersion.LEGACY,
    config: {
      inputUseSolBalance: mintIn.equals(NATIVE_MINT),
      outputUseSolBalance: mintOut.equals(NATIVE_MINT),
      associatedOnly: true,
    },
  });

  return { instructions: extractInstructionsFromTransaction(transaction), signers: [] };
}
