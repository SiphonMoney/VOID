// Script to generate a new Solana wallet keypair
// Usage: node scripts/generate-wallet.js [network]
// Network options: devnet (default), mainnet-beta, testnet

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const network = process.argv[2] || 'devnet';

console.log('\n🔐 Generating new Solana wallet keypair...\n');

try {
  // Generate new keypair
  const keypair = Keypair.generate();
  
  // Get public key (wallet address)
  const publicKey = keypair.publicKey.toString();
  
  // Get secret key as Uint8Array
  const secretKey = keypair.secretKey;
  
  // Convert to base58 for easier storage (Solana standard)
  const secretKeyBase58 = bs58.encode(secretKey);
  
  // Also keep as array for direct use
  const secretKeyArray = Array.from(secretKey);
  
  // Create wallet info object
  const walletInfo = {
    network: network,
    publicKey: publicKey,
    secretKeyBase58: secretKeyBase58,
    secretKeyArray: secretKeyArray,
    generatedAt: new Date().toISOString(),
    note: 'Keep this file secure! Never commit it to version control.'
  };
  
  // Create wallets directory if it doesn't exist
  const walletsDir = path.join(__dirname, '..', 'wallets');
  if (!fs.existsSync(walletsDir)) {
    fs.mkdirSync(walletsDir, { recursive: true });
  }
  
  // Save wallet info to JSON file
  const walletFile = path.join(walletsDir, `wallet-${network}-${Date.now()}.json`);
  fs.writeFileSync(walletFile, JSON.stringify(walletInfo, null, 2), 'utf8');
  
  // Also save to .env format for easy use
  const envFile = path.join(__dirname, '..', '.env');
  const envContent = `# Solana Wallet Configuration
# Generated: ${walletInfo.generatedAt}
# Network: ${network}

SOLANA_NETWORK=${network}
SOLANA_WALLET_PUBLIC_KEY=${publicKey}
SOLANA_WALLET_SECRET_KEY=${secretKeyBase58}

# RPC Endpoints
SOLANA_RPC_URL_DEVNET=https://api.devnet.solana.com
SOLANA_RPC_URL_MAINNET=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL_TESTNET=https://api.testnet.solana.com
`;
  
  // Append to .env or create new
  if (fs.existsSync(envFile)) {
    // Read existing .env
    const existingEnv = fs.readFileSync(envFile, 'utf8');
    
    // Check if Solana config already exists
    if (existingEnv.includes('SOLANA_WALLET_PUBLIC_KEY')) {
      console.log('⚠️  .env file already contains Solana wallet configuration.');
      console.log('   Updating existing values...\n');
      
      // Replace existing Solana config
      const lines = existingEnv.split('\n');
      const newLines = [];
      let skipUntilNextSection = false;
      
      for (const line of lines) {
        if (line.startsWith('# Solana Wallet Configuration')) {
          skipUntilNextSection = true;
          newLines.push(envContent.trim());
          continue;
        }
        if (skipUntilNextSection) {
          if (line.startsWith('#') && !line.includes('Solana')) {
            skipUntilNextSection = false;
            newLines.push(line);
          }
          // Skip old Solana lines
          continue;
        }
        newLines.push(line);
      }
      
      fs.writeFileSync(envFile, newLines.join('\n'), 'utf8');
    } else {
      // Append new Solana config
      fs.appendFileSync(envFile, '\n' + envContent, 'utf8');
    }
  } else {
    // Create new .env file
    fs.writeFileSync(envFile, envContent, 'utf8');
  }
  
  // Display wallet info
  console.log('✅ Wallet generated successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Network: ${network}`);
  console.log(`🔑 Public Key (Address): ${publicKey}`);
  console.log(`🔐 Secret Key (Base58): ${secretKeyBase58.substring(0, 20)}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('📁 Files created:');
  console.log(`   • Wallet JSON: ${walletFile}`);
  console.log(`   • Environment: ${envFile}\n`);
  
  console.log('⚠️  SECURITY WARNING:');
  console.log('   • Keep your secret key secure and never share it!');
  console.log('   • Never commit wallet files or .env to version control!');
  console.log('   • Add wallet files to .gitignore\n');
  
  console.log('💰 Next steps:');
  console.log(`   1. Fund this wallet on ${network}:`);
  console.log(`      • Devnet: https://faucet.solana.com/`);
  console.log(`      • Mainnet: Send SOL from another wallet`);
  console.log(`   2. Check balance: npm run check-balance`);
  console.log(`   3. Fund wallet: npm run fund-wallet (if you have a funder wallet)\n`);
  
} catch (error) {
  console.error('❌ Error generating wallet:', error.message);
  process.exit(1);
}
