// Extract pool ID from Raydium swap URL
// Usage: node scripts/extract-pool-from-url.js <url>

import { extractParamsFromRaydiumUrl, discoverPoolId } from '../modules/pool-discovery.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const RPC_URL = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';

async function extractPoolFromUrl(url) {
  console.log('\n🔍 Extracting Pool ID from Raydium URL\n');
  console.log(`URL: ${url}\n`);

  // 1. Extract parameters from URL
  const urlParams = extractParamsFromRaydiumUrl(url);
  if (!urlParams) {
    console.error('❌ Invalid URL or no swap parameters found');
    process.exit(1);
  }

  console.log('📋 URL Parameters:');
  console.log(`   inputMint: ${urlParams.inputMint || 'N/A'}`);
  console.log(`   outputMint: ${urlParams.outputMint || 'N/A'}`);
  console.log(`   poolId: ${urlParams.poolId || 'N/A'}\n`);

  // 2. If poolId is in URL, use it directly
  if (urlParams.poolId) {
    console.log(`✅ Pool ID found in URL: ${urlParams.poolId}\n`);
    return urlParams.poolId;
  }

  // 3. If mints are in URL, discover pool
  if (urlParams.inputMint && urlParams.outputMint) {
    console.log('🔍 Pool ID not in URL, discovering from mints...\n');

    const mintIn = urlParams.inputMint.toLowerCase() === 'sol'
      ? NATIVE_MINT
      : new PublicKey(urlParams.inputMint);
    const mintOut = urlParams.outputMint.toLowerCase() === 'sol'
      ? NATIVE_MINT
      : new PublicKey(urlParams.outputMint);

    const connection = new Connection(RPC_URL, 'confirmed');
    const poolId = await discoverPoolId({
      mintIn,
      mintOut,
      serializedTx: null,
      userPubkey: null,
      logFn: (msg, level) => {
        const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'success' ? '✅' : '🔍';
        console.log(`${prefix} ${msg}`);
      },
      url, // Pass URL for pool discovery
    });

    if (poolId) {
      console.log(`\n✅ Discovered Pool ID: ${poolId}\n`);
      return poolId;
    } else {
      console.log(`\n❌ Could not discover pool ID from mints\n`);
      console.log('💡 Options:');
      console.log('   1. Add poolId to URL: ?poolId=DKgK88CMJbQDpPWhhkN6j1sMVnXJJvuScubeTBKKNdwL');
      console.log('   2. Create a pool using: npm run create-token-pool');
      console.log('   3. Use a different swap interface\n');
      return null;
    }
  } else {
    console.error('❌ URL missing required parameters (inputMint and outputMint)');
    process.exit(1);
  }
}

// Get URL from command line
const url = process.argv[2];

if (!url) {
  console.log('Usage: node extract-pool-from-url.js <raydium-url>');
  console.log('\nExample:');
  console.log('  node extract-pool-from-url.js "https://raydium.io/swap/?inputMint=sol&outputMint=BApwgSFQHQU2Yhws1MyctZUY9gzNPv2o9k54EMNmZmJg"');
  console.log('\nOr with poolId:');
  console.log('  node extract-pool-from-url.js "https://raydium.io/swap/?inputMint=sol&outputMint=BApwg...&poolId=DKgK..."');
  process.exit(1);
}

extractPoolFromUrl(url)
  .then((poolId) => {
    if (poolId) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📋 Result:');
      console.log(`   Pool ID: ${poolId}`);
      console.log('═══════════════════════════════════════════════════════════\n');
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
