#!/usr/bin/env bash
set -e

# Colores para mensajes
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo -e "${BOLD}${CYAN}==> Instalador de antigravity-mcp-installer (Linux / macOS)${RESET}"

# 1. Verificar Node.js y npm
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Error: Node.js no está instalado.${RESET} Por favor instálalo desde https://nodejs.org (>= v18.0.0)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}Error: npm no está disponible.${RESET}"
  exit 1
fi

INSTALL_DIR="$HOME/.antigravity-mcp-installer"
BIN_DIR="$HOME/.local/bin"

mkdir -p "$BIN_DIR"

# 2. Clonar o actualizar repositorio
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "Actualizando repositorio existente en ${YELLOW}$INSTALL_DIR${RESET}..."
  cd "$INSTALL_DIR"
  git pull --quiet origin main
else
  echo -e "Descargando antigravity-mcp-installer en ${YELLOW}$INSTALL_DIR${RESET}..."
  rm -rf "$INSTALL_DIR"
  git clone --quiet https://github.com/hrnntz/antigravity-mcp-installer.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 3. Instalar dependencias
echo -e "Instalando dependencias de Node.js..."
npm install --omit=dev --silent

# 4. Asegurar permisos y crear enlaces simbólicos
chmod +x "$INSTALL_DIR/index.js"
ln -sf "$INSTALL_DIR/index.js" "$BIN_DIR/antigravity-mcp-installer"
ln -sf "$INSTALL_DIR/index.js" "$BIN_DIR/agy-mcp"

# 5. Comprobar si ~/.local/bin está en el PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo -e "${YELLOW}Aviso: $BIN_DIR no parece estar en tu variable PATH actual.${RESET}"
  echo -e "Añade la siguiente línea a tu archivo de configuración (~/.bashrc o ~/.zshrc):"
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}"
fi

echo ""
echo -e "${BOLD}${GREEN}✔ ¡Instalación completada exitosamente!${RESET}"
echo -e "Ahora puedes ejecutar cualquiera de estos comandos:"
echo -e "  ${BOLD}agy-mcp${RESET}              (alias corto)"
echo -e "  ${BOLD}antigravity-mcp-installer${RESET}"
echo ""
