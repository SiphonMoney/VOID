#!/bin/bash
# Build script for native Solana program

set -e

echo "🔨 Building native Solana program..."

# Navigate to program directory
cd programs/anonymaus-executor

# Build the program
cargo build-sbf

echo "✅ Build complete!"
echo "📦 Program binary: target/deploy/void_executor.so"
