# Contributing to antigravity-mcp-installer

Thank you for your interest in contributing! This project aims to provide a fast, secure, and user-friendly CLI to discover and configure MCP servers for Antigravity.

## Development Setup

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Getting Started

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/hrnntz/antigravity-mcp-installer.git
   cd antigravity-mcp-installer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run locally:
   ```bash
   node index.js --help
   # or with arguments
   node index.js brave-search
   ```

## Project Structure

```
.
├── index.js             # CLI entrypoint and commander argument parsing
├── src/
│   ├── api/
│   │   ├── npm.js       # npm registry search, metrics, and risk heuristic
│   │   └── osv.js       # Google OSV vulnerability query client
│   ├── config/
│   │   └── mcp.js       # mcp_config.json I/O, backup recovery, and atomic writes
│   ├── parser/
│   │   └── readme.js    # Markdown parser for env vars and capabilities
│   ├── ui/
│   │   └── prompts.js   # Inquirer interactive prompts and Esc navigation
│   ├── wizards/
│   │   ├── install.js   # Interactive search, audit, and install flow
│   │   └── manage.js    # Existing servers manager, API key editor, and audit
│   └── constants.js     # Shared configuration paths, symbols, and constants
└── test/                # Unit test suites using Node's native test runner
```

## Running Tests

We use Node's native test runner (`node:test`). No test dependencies required.

```bash
npm test
```

Please ensure all tests pass before submitting a pull request. If you introduce new features, add corresponding tests in `test/`.

## Pull Request Guidelines

1. Keep PRs focused on a single concern or fix.
2. Follow standard ESM JavaScript conventions.
3. Write clean, descriptive commit messages.
4. Ensure all CI matrix checks pass.
