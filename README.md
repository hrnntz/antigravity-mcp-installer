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
Launch without arguments to access the interactive menu (search, manage, audit):
```bash
agy-mcp
```

### 2. Quick Search & Install
Directly query an MCP server keyword:
```bash
agy-mcp github
agy-mcp postgres
agy-mcp sqlite
agy-mcp filesystem
```

### 3. Manage Installed Servers (List / Inspect / Remove)
Inspect installed servers and delete them with confirmation:
```bash
agy-mcp --manage
# or
agy-mcp --list
```

### 4. Live Vulnerability Audit of Installed Servers
Scan all configured MCP servers across Global and Local configs against Google's OSV database:
```bash
agy-mcp --audit
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `[query]` | Search keyword to install an MCP server | Prompts main menu |
| `-m, --manage` | Open management menu for configured servers | |
| `-l, --list` | List installed servers directly | |
| `-a, --audit` | Scan all installed servers for CVE vulnerabilities | |
| `-c, --config <path>` | Explicit path to `mcp_config.json` | Prompts Global vs Local |
| `-V, --version` | Output version | |
| `-h, --help` | Display help | |

## Key Capabilities

### 1. Installed Server Management & Removal
Easily inspect any existing MCP server in your `mcp_config.json` (view exact commands, arguments, environment variables) and remove servers cleanly with a single click and confirmation.

### 2. Real-Time CVE & Vulnerability Auditing
Integrated directly with **Google OSV (Open Source Vulnerabilities)** database (`api.osv.dev`):
- Audits packages before installing them.
- Audits your **already installed** MCP servers to notify you if any installed tool has discovered security advisories.

### 3. Ranked by Download Popularity
Search results are sorted by relevance to your keyword and ranked by weekly download count (`🔥 1,366 dl/wk`), filtering out generic libraries.

### 4. Full Keyboard Navigation (`[Esc]` to Go Back)
Press `[Esc]` (or choose `← Back`) at any step to return to the previous screen without exiting the CLI. Press `[Ctrl+C]` to exit immediately.

### 5. Global vs Local Configuration Scope
- **Global:** Configured in `~/.gemini/config/mcp_config.json` (available across all projects).
- **Local:** Configured in `./.gemini/mcp_config.json` (scoped exclusively to the current workspace).

## Generated Config Example

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-mcp"
      ]
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
