#!/usr/bin/env bash
set -e

BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo -e "${BOLD}${CYAN}==> Installing antigravity-mcp-installer (Linux / macOS)...${RESET}"

# 1. Verify Node.js and npm
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Error: Node.js is not installed.${RESET} Please install it from https://nodejs.org (>= v18.0.0)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}Error: npm is not available.${RESET}"
  exit 1
fi

INSTALL_DIR="$HOME/.antigravity-mcp-installer"
BIN_DIR="$HOME/.local/bin"

mkdir -p "$BIN_DIR"

# 2. Clone or update repository
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "Updating repository in ${YELLOW}$INSTALL_DIR${RESET}..."
  cd "$INSTALL_DIR"
  git pull --quiet origin main
else
  echo -e "Downloading antigravity-mcp-installer into ${YELLOW}$INSTALL_DIR${RESET}..."
  rm -rf "$INSTALL_DIR"
  git clone --quiet https://github.com/hrnntz/antigravity-mcp-installer.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 3. Install production dependencies
echo -e "Installing dependencies..."
npm install --omit=dev --silent

# 4. Set permissions and symlinks
chmod +x "$INSTALL_DIR/index.js"
ln -sf "$INSTALL_DIR/index.js" "$BIN_DIR/antigravity-mcp-installer"
ln -sf "$INSTALL_DIR/index.js" "$BIN_DIR/agy-mcp"

# 5. Check PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo -e "${YELLOW}Notice: $BIN_DIR does not seem to be in your current PATH.${RESET}"
  echo -e "Add this line to your shell configuration file (~/.bashrc or ~/.zshrc):"
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}"
fi

echo ""
echo -e "${BOLD}${GREEN}✔ Installation completed successfully!${RESET}"
echo -e "You can now run:"
echo -e "  ${BOLD}agy-mcp${RESET}                    (quick alias)"
echo -e "  ${BOLD}antigravity-mcp-installer${RESET}  (full command)"
echo ""
