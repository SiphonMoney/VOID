# PowerShell build script for native Solana program on Windows

Write-Host "🔨 Building native Solana program..." -ForegroundColor Cyan

# Navigate to program directory
Set-Location programs/anonymaus-executor

# Build the program
cargo build-sbf

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build complete!" -ForegroundColor Green
Write-Host "📦 Program binary: target/deploy/anonymaus_executor.so" -ForegroundColor Green

# Return to original directory
Set-Location ../..
