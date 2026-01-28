#!/bin/bash
# Build script for Anchor Solana program

set -e

echo "Building Anchor Solana program..."

# Navigate to Anchor program directory
cd programs/anonymous-executor-anchor

# Build the Anchor program
anchor build

echo "Build complete!"
echo "Program binary: target/deploy/anonymous_executor_anchor.so"

# Return to original directory
cd ../..