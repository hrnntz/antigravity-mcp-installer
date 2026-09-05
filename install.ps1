# antigravity-mcp-installer - Windows PowerShell Installer
$ErrorActionPreference = "Stop"

Write-Host "==> Installing antigravity-mcp-installer on Windows..." -ForegroundColor Cyan

# 1. Verify Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Node.js is not installed. Please download it from https://nodejs.org (>= v18.0.0)"
    exit 1
}

$InstallDir = Join-Path $HOME ".antigravity-mcp-installer"
$BinDir = Join-Path $InstallDir "bin"

# 2. Clone or update repository
if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "Updating repository in $InstallDir..." -ForegroundColor Yellow
    Set-Location $InstallDir
    git pull --quiet origin main
} else {
    Write-Host "Downloading repository to $InstallDir..." -ForegroundColor Yellow
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    git clone --quiet https://github.com/hrnntz/antigravity-mcp-installer.git $InstallDir
    Set-Location $InstallDir
}

# 3. Install production dependencies
Write-Host "Installing dependencies..."
npm install --omit=dev --silent

# 4. Create batch shims
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }

$IndexPath = Join-Path $InstallDir "index.js"

$CmdShim = @"
@echo off
node "$IndexPath" %*
"@

Set-Content -Path (Join-Path $BinDir "antigravity-mcp-installer.cmd") -Value $CmdShim
Set-Content -Path (Join-Path $BinDir "agy-mcp.cmd") -Value $CmdShim

# 5. Add to user PATH
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    $env:Path += ";$BinDir"
    Write-Host "Added $BinDir to your user PATH." -ForegroundColor Yellow
}

Write-Host "`n✔ Installation completed successfully!" -ForegroundColor Green
Write-Host "You can now run:"
Write-Host "  agy-mcp                    (short alias)" -ForegroundColor White
Write-Host "  antigravity-mcp-installer  (full command)" -ForegroundColor White
Write-Host "Note: If you open a new terminal window, the command will be available immediately.`n"
