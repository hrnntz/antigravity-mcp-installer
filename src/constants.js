import path from 'node:path';
import os from 'node:os';

export const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
export const LOCAL_CONFIG_PATH = path.join(process.cwd(), '.gemini', 'mcp_config.json');

// npm package name standard RFC regex
export const VALID_NPM_PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

// Protect against Prototype Pollution
export const FORBIDDEN_SERVER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Sentinel value to identify when user requests to go back via Esc
export const BACK_SIGNAL = Symbol('BACK_SIGNAL');
