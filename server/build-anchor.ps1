# PowerShell build script for Anchor Solana program on Windows
Write-Host "Building Anchor Solana program..." -ForegroundColor Cyan

# Navigate to Anchor program directory
Set-Location programs/anonymous-executor-anchor

# Build the Anchor program
anchor build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    Set-Location ../..
    exit 1
}

Write-Host "Build complete!" -ForegroundColor Green
Write-Host "Program binary: target/deploy/anonymous_executor_anchor.so" -ForegroundColor White

# Return to original directory
Set-Location ../..