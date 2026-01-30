# PowerShell build script for native Solana program on Windows

Write-Host "Building native Solana program..."

# Navigate to program directory
Set-Location programs/anonymaus-executor

# Build the program
cargo build-sbf

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed"
    exit 1
}

# Copy build output into deploy directory for solana CLI
$deploySo = "target/deploy/anonymaus_executor.so"
$defaultSo = "target/deploy/void_executor.so"
$releaseSo = "target/sbpf-solana-solana/release/anonymaus_executor.so"

if (Test-Path $releaseSo) {
    Copy-Item $releaseSo $deploySo -Force
    Write-Host "Program binary: $deploySo"
} elseif (Test-Path $defaultSo) {
    Copy-Item $defaultSo $deploySo -Force
    Write-Host "Program binary: $deploySo"
} else {
    Write-Host "Build artifact not found: $releaseSo or $defaultSo"
    exit 1
}

# Return to original directory
Set-Location ../..
