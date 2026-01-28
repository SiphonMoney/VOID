// Helper script to find the private key for a given address
// Usage: node scripts/find-execution-key.js <address>
// This will try to find the private key from common locations

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const targetAddress = process.argv[2] || '0xDeAd7622354930a6bfd57E0829C895CD85C3A05b';

console.log(`\n🔍 Looking for private key for address: ${targetAddress}\n`);

// Check 1: Environment variables
console.log('1️⃣ Checking environment variables...');
const envKey = process.env.EXECUTION_ACCOUNT_PRIVATE_KEY;
if (envKey) {
  try {
    const wallet = new ethers.Wallet(envKey);
    if (wallet.address.toLowerCase() === targetAddress.toLowerCase()) {
      console.log(`✅ Found in .env: ${envKey}`);
      process.exit(0);
    } else {
      console.log(`❌ .env key doesn't match (produces: ${wallet.address})`);
    }
  } catch (e) {
    console.log(`❌ Invalid key in .env`);
  }
} else {
  console.log(`❌ EXECUTION_ACCOUNT_PRIVATE_KEY not in .env`);
}

// Check 2: Common test keys
console.log('\n2️⃣ Checking common test keys...');
const commonKeys = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  // Add more if you have them
];

for (const key of commonKeys) {
  try {
    const wallet = new ethers.Wallet(key);
    if (wallet.address.toLowerCase() === targetAddress.toLowerCase()) {
      console.log(`✅ Found: ${key}`);
      process.exit(0);
    }
  } catch (e) {
    // Skip invalid keys
  }
}
console.log(`❌ Not found in common keys`);

console.log(`\n❌ Private key not found automatically.`);
console.log(`\n💡 Solutions:`);
console.log(`   1. Check your deployment logs from when you ran: npm run deploy-executor`);
console.log(`   2. If you have the private key, add it to server.js as HARDCODED_EXECUTION_ACCOUNT_PRIVATE_KEY`);
console.log(`   3. Or redeploy with: npm run deploy-executor (this will show you the new private key)`);
console.log(`\n`);
