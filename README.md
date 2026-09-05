# antigravity-mcp-installer

A fast, interactive CLI to discover, security-audit, and install MCP (Model Context Protocol) servers into Antigravity CLI.

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

## Usage

Run interactive search:
```bash
agy-mcp
```

Pass a search term directly:
```bash
agy-mcp sqlite
agy-mcp postgres
agy-mcp filesystem
```

Specify an explicit config file:
```bash
agy-mcp git --config ./custom_mcp_config.json
```

## Key Capabilities

### 1. Automated Security Risk Audit
Every package is evaluated and cross-referenced in real-time against Google's **OSV (Open Source Vulnerabilities)** database (`api.osv.dev`) and npm registry telemetry:

- **LOW RISK (🟢):** No active CVEs, verified source repository, high download volume, or official `@modelcontextprotocol` package.
- **MEDIUM RISK (🟡):** Low download volume (<100/week) or missing source repository metadata.
- **HIGH RISK (🔴):** Active unpatched CVEs found in vulnerability databases, or unvetted/suspicious packages. Requires explicit user confirmation to proceed.

### 2. Global vs Private (Local) Configuration Scope
Choose where the server is registered:
- **Global:** Installed into `~/.gemini/config/mcp_config.json` (available across all your projects).
- **Privado / Local:** Installed into `./.gemini/mcp_config.json` (scoped exclusively to your current project/repository).

### 3. Flexible Execution
- **`npx` (Recommended):** Zero local footprint, runs on-demand with `-y`.
- **`npm install -g`:** Installs permanently on your system.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `[query]` | Package keyword to query npm registry | Prompts interactively |
| `-c, --config <path>` | Explicit path to `mcp_config.json` | Prompts for Global vs Local |
| `-V, --version` | Output version | |
| `-h, --help` | Display help | |

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
