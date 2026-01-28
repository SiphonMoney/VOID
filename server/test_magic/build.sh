#!/bin/bash
# Build script for test program

set -e

echo "🔨 Building test program..."

# Build for Solana
cargo build-sbf --manifest-path=Cargo.toml

echo "✅ Build complete!"
echo "📦 Program: target/deploy/test_magic.so"
echo ""
echo "To deploy:"
echo "  solana program deploy target/deploy/test_magic.so --program-id target/deploy/test_magic-keypair.json"
