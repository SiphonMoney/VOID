# Build script for test program (PowerShell)

Write-Host "🔨 Building test program..." -ForegroundColor Cyan

# Build for Solana
cargo build-sbf --manifest-path=Cargo.toml

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build complete!" -ForegroundColor Green
    Write-Host "📦 Program: target/deploy/test_magic.so" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To deploy:" -ForegroundColor Cyan
    Write-Host "  solana program deploy target/deploy/test_magic.so --program-id target/deploy/test_magic-keypair.json" -ForegroundColor White
} else {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}
