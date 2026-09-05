# antigravity-mcp-installer

A lightweight CLI to discover MCP (Model Context Protocol) servers from npm and register them directly into Antigravity CLI's configuration (`~/.gemini/config/mcp_config.json`).

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

Specify a custom configuration file:
```bash
agy-mcp git --config ./custom_mcp_config.json
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `[query]` | Package keyword to query npm registry | Prompts interactively |
| `-c, --config <path>` | Path to `mcp_config.json` | `~/.gemini/config/mcp_config.json` |
| `-V, --version` | Output version | |
| `-h, --help` | Display help | |

## How It Works

1. Queries the npm registry API (`registry.npmjs.org/-/v1/search`) filtering for MCP packages matching your query.
2. Lets you pick a server from the interactive terminal list.
3. Asks whether to run via `npx` (recommended: zero disk footprint, executes on-demand) or install globally via `npm install -g`.
4. Safely parses and updates `~/.gemini/config/mcp_config.json`, preserving existing entries and verifying JSON integrity.

### Generated Config Example

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

## Security

- **No Shell Injection:** Package installation invokes `child_process.spawn` with argument arrays directly (`shell: false`). No shell concatenation.
- **Package Name Validation:** All package candidates are validated against the official npm package naming specification.
- **Prototype Pollution Prevention:** Server identifiers are sanitized and checked against reserved JavaScript properties (`__proto__`, `constructor`, `prototype`).
- **Atomic Writes:** Configuration writes use temporary files and atomic rename operations to prevent partial file corruption.

## Local Development

```bash
git clone https://github.com/hrnntz/antigravity-mcp-installer.git
cd antigravity-mcp-installer
npm install
node index.js
```

## License

MIT © [Hernán Arteaga](https://github.com/hrnntz)
