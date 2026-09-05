# antigravity-mcp-installer - Instalador para Windows (PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "==> Instalando antigravity-mcp-installer en Windows..." -ForegroundColor Cyan

# 1. Verificar Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Node.js no está instalado. Descárgalo de https://nodejs.org (>= v18.0.0)"
    exit 1
}

$InstallDir = Join-Path $HOME ".antigravity-mcp-installer"
$BinDir = Join-Path $InstallDir "bin"

# 2. Clonar o actualizar
if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "Actualizando repositorio en $InstallDir..." -ForegroundColor Yellow
    Set-Location $InstallDir
    git pull --quiet origin main
} else {
    Write-Host "Descargando repositorio en $InstallDir..." -ForegroundColor Yellow
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    git clone --quiet https://github.com/hrnntz/antigravity-mcp-installer.git $InstallDir
    Set-Location $InstallDir
}

# 3. Instalar dependencias
Write-Host "Instalando dependencias..."
npm install --omit=dev --silent

# 4. Crear shims para CMD y PowerShell en bin/
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }

$IndexPath = Join-Path $InstallDir "index.js"

$CmdShim = @"
@echo off
node "$IndexPath" %*
"@

Set-Content -Path (Join-Path $BinDir "antigravity-mcp-installer.cmd") -Value $CmdShim
Set-Content -Path (Join-Path $BinDir "agy-mcp.cmd") -Value $CmdShim

# 5. Agregar $BinDir al PATH de usuario si no existe
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    $env:Path += ";$BinDir"
    Write-Host "Se agrego $BinDir al PATH de tu usuario." -ForegroundColor Yellow
}

Write-Host "`n✔ Instalacion completada exitosamente!" -ForegroundColor Green
Write-Host "Puedes ejecutar:"
Write-Host "  agy-mcp                    (alias corto)" -ForegroundColor White
Write-Host "  antigravity-mcp-installer  (nombre completo)" -ForegroundColor White
Write-Host "Nota: Si abres una nueva ventana de terminal, los comandos estaran disponibles inmediatamente.`n"
