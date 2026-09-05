# antigravity-mcp-installer

[![npm version](https://img.shields.io/npm/v/antigravity-mcp-installer.svg)](https://www.npmjs.com/package/antigravity-mcp-installer) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A fast, interactive CLI to discover, security-audit, configure, and manage MCP (Model Context Protocol) servers for Antigravity CLI.

Provides two terminal commands: `antigravity-mcp-installer` and `agy-mcp`.

## Quick Install

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

### Direct on-demand execution (npx)
```bash
npx antigravity-mcp-installer
```

## Usage

### 1. Interactive Main Menu
Launch without arguments to access the interactive wizard:
```bash
agy-mcp
```

### 2. Direct Search & Install
```bash
agy-mcp brave-search
agy-mcp github
agy-mcp postgres
agy-mcp sqlite
agy-mcp filesystem
```

### 3. Manage Installed Servers & API Keys
Inspect configured servers, edit/add API keys, or delete servers cleanly:
```bash
agy-mcp --manage
# or
agy-mcp --list
```

### 4. Vulnerability Audit
Audit all installed MCP servers against Google OSV database:
```bash
agy-mcp --audit
```

## Key Capabilities

### 1. Automatic API Key & Environment Variable Detection
The CLI scans the MCP server's documentation to detect required API keys (e.g. `BRAVE_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `DATABASE_URL`) and prompts you to fill them in securely during installation, saving them directly into the `"env"` object. You can also add or edit API keys later via `--manage`.

### 2. Real-Time CVE & Vulnerability Auditing
Integrated with Google's **OSV (Open Source Vulnerabilities)** database (`api.osv.dev`):
- Audits packages before installation.
- Audits your **already installed** MCP servers to notify you if any tool has active advisories.

### 3. Server Management & Safe Removal
Easily inspect any existing MCP server in your `mcp_config.json` (view exact commands, arguments, masked environment variables) and remove servers cleanly with confirmation.

### 4. Ranked by Download Popularity
Results are prioritized by exact keyword relevance and ranked by weekly download count (`🔥 1,366 dl/wk`), filtering out generic libraries.

### 5. Full Keyboard Navigation (`[Esc]` to Go Back)
Press `[Esc]` (or choose `← Back`) at any step to return to the previous screen without exiting the CLI. Press `[Ctrl+C]` to exit immediately.

## Generated Config Example

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
        "BRAVE_API_KEY": "BSAxxxxxxxxxxxx"
      }
    }
  }
}
```

## Security Design

- **Vulnerability Scanning:** Live query to Google OSV database (`api.osv.dev`) for package advisories.
- **No Shell Injection:** Executes `child_process.spawn` with argument arrays directly (`shell: false`).
- **RFC Package Validation:** Rejects any input that does not conform strictly to npm naming standards.
- **Prototype Pollution Defense:** Identifiers are checked against reserved properties (`__proto__`, `constructor`, `prototype`).
- **Atomic Disk Writes:** Updates configs via temporary files and atomic rename operations.

## Local Development

```bash
git clone https://github.com/hrnntz/antigravity-mcp-installer.git
cd antigravity-mcp-installer
npm install
node index.js
```

## License

MIT © [Hernán Arteaga](https://github.com/hrnntz)
