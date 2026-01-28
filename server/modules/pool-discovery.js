// Pool Discovery Module
// Handles finding Raydium pool IDs from various sources

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';

// Known Raydium program IDs
const RAYDIUM_PROGRAM_IDS = new Set([
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // AMM v4 mainnet
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // CLMM mainnet
  'RVKd61ztZW9GUwhRbbLoYVRE5Xf9B2t3sc6qwfqE3zH', // CLMM devnet
  'CPMMoo8L3F4NbTegBCKVNunggL1tnt2ec5zM1YkqFhL2', // CPMM
  'DRaybByLpbUL57LJARs3j8BitTxVfzBg351EaMr5UTCd', // Raydium Router/AMM (devnet/mainnet)
  'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb', // Raydium Pool Program
]);

// Known devnet pools (for quick lookup - fallback when API fails)
const KNOWN_POOLS = {
  'DKgK88CMJbQDpPWhhkN6j1sMVnXJJvuScubeTBKKNdwL': {
    tokenA: 'So11111111111111111111111111111111111111112', // SOL
    tokenB: 'BApwgSFQHQU2Yhws1MyctZUY9gzNPv2o9k54EMNmZmJg', // zUSDC
  },
};

/**
 * Check if mints match a known pool
 */
export function getKnownPoolForMints(mintA, mintB) {
  const mintAStr = mintA instanceof PublicKey ? mintA.toBase58() : mintA;
  const mintBStr = mintB instanceof PublicKey ? mintB.toBase58() : mintB;

  for (const [poolId, { tokenA, tokenB }] of Object.entries(KNOWN_POOLS)) {
    if (
      (mintAStr === tokenA && mintBStr === tokenB) ||
      (mintAStr === tokenB && mintBStr === tokenA)
    ) {
      return poolId;
    }
  }
  return null;
}

/**
 * Extract pool ID from serialized transaction
 */
export function extractPoolIdFromSerialized(serializedBase64, logFn = null, userPubkey = null) {
  if (!serializedBase64 || typeof serializedBase64 !== 'string') {
    if (logFn) logFn(`⚠️ No serialized transaction data provided for poolId extraction`, 'warn');
    return null;
  }

  try {
    const serializedBuffer = Buffer.from(serializedBase64, 'base64');
    if (logFn) logFn(`🔍 Attempting poolId extraction from ${serializedBuffer.length} bytes`, 'info');

    const userPubkeyStr = userPubkey ? userPubkey.toBase58() : null;

    // Try legacy transaction first
    try {
      const legacyTx = Transaction.from(serializedBuffer);
      const ix = legacyTx.instructions.find(i => RAYDIUM_PROGRAM_IDS.has(i.programId.toBase58()));
      if (ix && ix.keys && ix.keys.length > 0) {
        for (const key of ix.keys) {
          const poolId = key.pubkey.toBase58();
          if (userPubkeyStr && poolId === userPubkeyStr) {
            continue; // Skip user's wallet
          }
          if (logFn) logFn(`🔍 Extracted poolId from legacy tx: ${poolId}`, 'info');
          return poolId;
        }
      }
    } catch (legacyError) {
      // Continue to versioned transaction
    }

    // Try versioned transaction
    const vtx = VersionedTransaction.deserialize(serializedBuffer);
    const msg = vtx.message;
    const accountKeys = msg.staticAccountKeys || [];
    const ixList = msg.compiledInstructions || [];

    if (logFn) logFn(`🔍 Versioned tx: ${accountKeys.length} accounts, ${ixList.length} instructions`, 'info');

    for (const ix of ixList) {
      const programId = accountKeys[ix.programIdIndex]?.toBase58();
      if (logFn) logFn(`🔍 Instruction programId: ${programId}`, 'info');

      if (programId && RAYDIUM_PROGRAM_IDS.has(programId)) {
        if (logFn) logFn(`✅ Found Raydium instruction with ${ix.accountKeyIndexes?.length || 0} accounts`, 'info');

        // Check multiple positions (pool location varies by instruction type)
        // Skip position 0 (usually fee payer/user wallet)
        const positionsToCheck = [6, 7, 8, 9, 10, 13, 14, 15, 1, 2, 3, 4, 5];

        for (const pos of positionsToCheck) {
          if (pos < (ix.accountKeyIndexes?.length || 0)) {
            const keyIndex = ix.accountKeyIndexes[pos];
            const poolKey = accountKeys[keyIndex];
            if (poolKey) {
              const poolId = poolKey.toBase58();
              // Skip if it's the user's wallet
              if (userPubkeyStr && poolId === userPubkeyStr) {
                if (logFn) logFn(`🔍 Skipping user wallet at position ${pos}: ${poolId}`, 'info');
                continue;
              }
              if (logFn) logFn(`🔍 Checking account position ${pos} (index ${keyIndex}): ${poolId}`, 'info');
              if (logFn) logFn(`✅ Extracted poolId from versioned tx (position ${pos}): ${poolId}`, 'info');
              return poolId;
            }
          }
        }
      }
    }

    if (logFn) logFn(`⚠️ No Raydium instruction found in transaction`, 'warn');
  } catch (error) {
    if (logFn) {
      logFn(`⚠️ Failed to derive poolId from serialized tx: ${error.message}`, 'warn');
    }
  }

  return null;
}

/**
 * Fetch pool ID from Raydium API by token mints
 * Tries multiple API endpoints and response formats
 */
export async function fetchPoolIdFromRaydiumAPI(mintA, mintB, logFn = null) {
  const mintAStr = mintA instanceof PublicKey ? mintA.toBase58() : mintA;
  const mintBStr = mintB instanceof PublicKey ? mintB.toBase58() : mintB;

  const apiBases = [
    process.env.RAYDIUM_API_URL || 'https://api-v3-devnet.raydium.io',
    'https://api-v3-devnet.raydium.io',
    'https://api-v3.raydium.io',
    'https://api.raydium.io',
  ];

  const endpointPatterns = [
    // API v3 patterns
    `/pools?mintA=${mintAStr}&mintB=${mintBStr}`,
    `/pools?mintA=${mintBStr}&mintB=${mintAStr}`,
    `/pools/info?mintA=${mintAStr}&mintB=${mintBStr}`,
    `/pools/info?mintA=${mintBStr}&mintB=${mintAStr}`,
    // Alternative patterns
    `/v2/ammV4/pools?mintA=${mintAStr}&mintB=${mintBStr}`,
    `/v2/ammV4/pools?mintA=${mintBStr}&mintB=${mintAStr}`,
    // Search by mint
    `/pools/search?mint=${mintAStr}`,
    `/pools/search?mint=${mintBStr}`,
  ];

  for (const apiBase of apiBases) {
    for (const endpoint of endpointPatterns) {
      try {
        const url = `${apiBase}${endpoint}`;
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          if (response.status !== 404 && logFn) {
            logFn(`⚠️ API returned ${response.status} for ${url}`, 'warn');
          }
          continue;
        }

        const data = await response.json();
        const pools = extractPoolsFromResponse(data);
        
        if (pools.length === 0) continue;

        // Find pool that matches both mints
        for (const pool of pools) {
          const poolId = extractPoolId(pool);
          const { baseMint, quoteMint } = extractMints(pool);

          if (poolId && baseMint && quoteMint) {
            if (matchesMints(baseMint, quoteMint, mintAStr, mintBStr)) {
              if (logFn) logFn(`✅ Found matching pool from Raydium API: ${poolId}`, 'success');
              return poolId;
            }
          } else if (poolId && pools.length === 1) {
            // Single result without mint info - use it
            if (logFn) logFn(`✅ Found poolId from Raydium API (single result): ${poolId}`, 'success');
            return poolId;
          }
        }
      } catch (error) {
        if (logFn && error.name !== 'AbortError') {
          logFn(`⚠️ API request failed: ${error.message}`, 'warn');
        }
        continue;
      }
    }
  }

  if (logFn) logFn(`⚠️ No pools found via API for ${mintAStr}/${mintBStr}`, 'warn');
  return null;
}

/**
 * Extract pools array from various API response formats
 */
function extractPoolsFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.pools && Array.isArray(data.pools)) return data.pools;
  if (data && typeof data === 'object') return [data];
  return [];
}

/**
 * Extract pool ID from pool object
 */
function extractPoolId(pool) {
  return pool.id || pool.poolId || pool.address || pool.pool || pool.poolAddress || null;
}

/**
 * Extract mints from pool object
 */
function extractMints(pool) {
  return {
    baseMint: pool.baseMint || pool.mintA || pool.tokenA?.mint || pool.token0?.mint || null,
    quoteMint: pool.quoteMint || pool.mintB || pool.tokenB?.mint || pool.token1?.mint || null,
  };
}

/**
 * Check if pool mints match requested mints (order-independent)
 */
function matchesMints(baseMint, quoteMint, mintA, mintB) {
  return (
    (baseMint === mintA && quoteMint === mintB) ||
    (baseMint === mintB && quoteMint === mintA)
  );
}

/**
 * Extract mints and poolId from Raydium swap URL
 * Example: https://raydium.io/swap/?inputMint=sol&outputMint=BApwg...&poolId=DKgK...
 */
export function extractParamsFromRaydiumUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const inputMint = parsedUrl.searchParams.get('inputMint');
    const outputMint = parsedUrl.searchParams.get('outputMint');
    const poolId = parsedUrl.searchParams.get('poolId');

    if (inputMint || outputMint || poolId) {
      return {
        inputMint: inputMint || null,
        outputMint: outputMint || null,
        poolId: poolId || null,
      };
    }
  } catch (error) {
    // Invalid URL
  }

  return null;
}

/**
 * Discover pool ID from on-chain data by querying program accounts
 * This queries the blockchain directly to find pools matching the token mints
 * NOTE: This is expensive and should be used as a last resort
 */
export async function discoverPoolFromOnChain(connection, mintA, mintB, logFn = null) {
  const mintAStr = mintA instanceof PublicKey ? mintA.toBase58() : mintA;
  const mintBStr = mintB instanceof PublicKey ? mintB.toBase58() : mintB;

  try {
    if (logFn) logFn(`🔍 Querying on-chain for pools matching ${mintAStr}/${mintBStr}...`, 'info');

    // CPMM pools (most common on devnet)
    const CPMM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL1tnt2ec5zM1YkqFhL2');
    
    // This is expensive - would need to decode pool layouts to check mints
    // For now, we rely on API lookup which is much faster
    const cpmmAccounts = await connection.getProgramAccounts(CPMM_PROGRAM_ID, {
      filters: [{ dataSize: 800 }], // Approximate CPMM pool size
    });

    if (logFn) logFn(`🔍 Found ${cpmmAccounts.length} CPMM pool accounts (decoding not implemented)`, 'info');

    // TODO: Decode pool layouts and match mints
    // This would require importing Raydium SDK layouts

    return null;
  } catch (error) {
    if (logFn) logFn(`⚠️ On-chain pool discovery failed: ${error.message}`, 'warn');
    return null;
  }
}

/**
 * Normalize mint address (handle 'sol' -> native mint)
 */
function normalizeMint(mint) {
  if (typeof mint === 'string' && mint.toLowerCase() === 'sol') {
    return 'So11111111111111111111111111111111111111112';
  }
  return mint instanceof PublicKey ? mint.toBase58() : mint;
}

/**
 * Discover pool ID from multiple sources
 * 
 * Priority order:
 * 1. URL poolId (if present in URL)
 * 2. Raydium API lookup (dynamic discovery by token mints)
 * 3. Known pools (fallback cache)
 * 4. Transaction extraction (from intercepted transaction)
 * 5. On-chain discovery (expensive, last resort)
 */
export async function discoverPoolId({
  mintIn,
  mintOut,
  serializedTx = null,
  userPubkey = null,
  logFn = null,
  url = null,
  connection = null,
}) {
  const mintInStr = normalizeMint(mintIn);
  const mintOutStr = normalizeMint(mintOut);

  // 1. Check URL for poolId first (if provided)
  if (url) {
    const urlParams = extractParamsFromRaydiumUrl(url);
    if (urlParams?.poolId) {
      if (logFn) logFn(`✅ Found poolId in URL: ${urlParams.poolId}`, 'info');
      return urlParams.poolId;
    }
  }

  // 2. Try Raydium API (dynamic discovery by mints)
  if (logFn) logFn(`🔍 Discovering pool from token mints via Raydium API...`, 'info');
  const apiPoolId = await fetchPoolIdFromRaydiumAPI(mintInStr, mintOutStr, logFn);
  if (apiPoolId) {
    return apiPoolId;
  }

  // 3. Check known pools (fallback for devnet pools we created)
  const knownPool = getKnownPoolForMints(mintInStr, mintOutStr);
  if (knownPool) {
    if (logFn) logFn(`✅ Using known pool (fallback): ${knownPool}`, 'info');
    return knownPool;
  }

  // 4. Try extracting from serialized transaction
  if (serializedTx) {
    const extractedPoolId = extractPoolIdFromSerialized(serializedTx, logFn, userPubkey);
    if (extractedPoolId && (!userPubkey || extractedPoolId !== userPubkey.toBase58())) {
      if (logFn) logFn(`🔍 Derived poolId from serialized tx: ${extractedPoolId}`, 'info');
      return extractedPoolId;
    }
  }

  // 5. On-chain discovery (expensive, last resort)
  if (connection) {
    const onChainPoolId = await discoverPoolFromOnChain(connection, mintInStr, mintOutStr, logFn);
    if (onChainPoolId) {
      return onChainPoolId;
    }
  }

  return null;
}
