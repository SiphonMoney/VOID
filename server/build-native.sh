#!/bin/bash
# Build script for native Solana program

set -e

echo "🔨 Building native Solana program..."

# Navigate to program directory
cd programs/anonymaus-executor

# Build the program
cargo build-sbf

echo "✅ Build complete!"

# Copy build output into deploy directory for solana CLI
RELEASE_SO="target/sbpf-solana-solana/release/anonymaus_executor.so"
DEPLOY_SO="target/deploy/anonymaus_executor.so"
DEFAULT_SO="target/deploy/void_executor.so"

if [ -f "$RELEASE_SO" ]; then
  cp "$RELEASE_SO" "$DEPLOY_SO"
  echo "📦 Program binary: $DEPLOY_SO"
elif [ -f "$DEFAULT_SO" ]; then
  cp "$DEFAULT_SO" "$DEPLOY_SO"
  echo "📦 Program binary: $DEPLOY_SO"
else
  echo "❌ Build artifact not found: $RELEASE_SO or $DEFAULT_SO"
  exit 1
fi
