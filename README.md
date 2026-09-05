# antigravity-mcp-installer

[![CI](https://github.com/hrnntz/antigravity-mcp-installer/actions/workflows/ci.yml/badge.svg)](https://github.com/hrnntz/antigravity-mcp-installer/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/antigravity-mcp-installer.svg)](https://www.npmjs.com/package/antigravity-mcp-installer) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI tool to search, install, and manage Model Context Protocol (MCP) servers for Antigravity CLI.

Provides two terminal commands: `antigravity-mcp-installer` and `agy-mcp`.

## Installation

### Linux / macOS
```bash
curl -fsSL https://raw.githubusercontent.com/hrnntz/antigravity-mcp-installer/main/install.sh | bash
```

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/hrnntz/antigravity-mcp-installer/main/install.ps1 | iex
```

### npm (Global)
```bash
npm install -g antigravity-mcp-installer
```

### Direct execution (npx)
```bash
npx antigravity-mcp-installer
```

## Usage

### Interactive wizard
```bash
agy-mcp
```

### Direct search & install
```bash
agy-mcp <query>
```
Example:
```bash
agy-mcp brave-search
```

### Manage installed servers
View installed servers, edit environment variables/API keys, or remove servers:
```bash
agy-mcp --manage
```

### Vulnerability audit
Check installed servers against the Google OSV database:
```bash
agy-mcp --audit
```

## Configuration

Configurations are saved to `~/.gemini/config/mcp_config.json` (Global) or `./.gemini/mcp_config.json` (Project):

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-brave-search"
      ],
      "env": {
        "BRAVE_API_KEY": "your-key-here"
      }
    }
  }
}
```

## License

MIT © [Hernán Arteaga](https://github.com/hrnntz)
