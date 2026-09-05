#!/usr/bin/env node

/**
 * antigravity-mcp-installer
 * Interactive CLI to search and register MCP servers in Antigravity CLI.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import pc from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');

// npm package name standard regex (RFC / npm spec compliance)
const VALID_NPM_PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

// Protect against Prototype Pollution
const FORBIDDEN_SERVER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function printBanner() {
  console.log();
  console.log(pc.bold(pc.cyan('antigravity-mcp-installer')) + pc.dim(' (agy-mcp)'));
  console.log(pc.dim('Search & configure MCP servers for Antigravity CLI'));
  console.log();
}

/**
 * Safe process execution without shell invocation to prevent command injection
 */
function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    // On Windows, npm is a cmd script
    const cmd = isWindows && command === 'npm' ? 'npm.cmd' : command;

    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Search MCP servers via npm registry API
 */
async function searchNpmMcpServers(searchTerm) {
  const sanitizedTerm = searchTerm.trim().replace(/[\r\n\0]/g, '');
  if (!sanitizedTerm) return [];

  const spinner = ora({
    text: `Searching npm registry for "${sanitizedTerm}"...`,
    color: 'cyan'
  }).start();

  try {
    let query = `${sanitizedTerm} mcp-server`;
    let url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=30`;

    let response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'antigravity-mcp-installer'
      }
    });

    if (!response.ok) {
      throw new Error(`npm registry returned HTTP ${response.status}`);
    }

    let data = await response.json();

    // Fallback if zero items returned
    if (!data.objects || data.objects.length === 0) {
      spinner.text = 'Broadening query...';
      query = `${sanitizedTerm} mcp`;
      url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=30`;
      response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'antigravity-mcp-installer'
        }
      });
      if (response.ok) {
        data = await response.json();
      }
    }

    spinner.succeed('Search completed.');

    if (!Array.isArray(data.objects) || data.objects.length === 0) {
      return [];
    }

    // Filter and sanitize entries
    return data.objects
      .filter(item => item?.package?.name && VALID_NPM_PACKAGE_NAME.test(item.package.name))
      .map(item => ({
        name: item.package.name,
        version: item.package.version || '0.0.0',
        description: item.package.description || 'No description available'
      }));
  } catch (error) {
    spinner.fail(pc.red('Failed to reach npm registry.'));
    throw error;
  }
}

/**
 * Safely read or create mcp_config.json
 */
async function loadOrCreateConfig(configPath) {
  const normalizedPath = path.resolve(configPath);
  const dirPath = path.dirname(normalizedPath);

  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code === 'EACCES') {
      throw new Error(`Permission denied creating directory: ${dirPath}`);
    }
    throw err;
  }

  try {
    const rawData = await fs.readFile(normalizedPath, 'utf-8');
    const parsed = JSON.parse(rawData);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Config file root must be a JSON object.');
    }

    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers)) {
      parsed.mcpServers = Object.create(null);
    }

    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      const initialConfig = { mcpServers: {} };
      await fs.writeFile(normalizedPath, JSON.stringify(initialConfig, null, 2) + '\n', 'utf-8');
      return initialConfig;
    }

    if (err instanceof SyntaxError) {
      throw new Error(`Corrupted JSON in ${normalizedPath}: ${err.message}`);
    }

    if (err.code === 'EACCES') {
      throw new Error(`Permission denied reading ${normalizedPath}`);
    }

    throw err;
  }
}

/**
 * Persist config atomically
 */
async function saveConfig(configPath, configData) {
  const normalizedPath = path.resolve(configPath);
  const tempPath = `${normalizedPath}.${Date.now()}.tmp`;

  try {
    const formatted = JSON.stringify(configData, null, 2) + '\n';
    await fs.writeFile(tempPath, formatted, 'utf-8');
    await fs.rename(tempPath, normalizedPath);
  } catch (err) {
    try { await fs.unlink(tempPath); } catch {}
    if (err.code === 'EACCES') {
      throw new Error(`Permission denied writing ${normalizedPath}`);
    }
    throw err;
  }
}

/**
 * Sanitize package name for default key
 */
function sanitizeServerKey(pkgName) {
  return pkgName
    .replace(/^@[^/]+\//, '')
    .replace(/^server-/, '')
    .replace(/-server$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
}

async function main() {
  const program = new Command();

  program
    .name('antigravity-mcp-installer')
    .alias('agy-mcp')
    .description('Interactive MCP server installer for Antigravity CLI')
    .version('1.0.0')
    .argument('[query]', 'Search term (e.g. filesystem, postgres, sqlite)')
    .option('-c, --config <path>', 'Custom path to mcp_config.json', DEFAULT_CONFIG_PATH)
    .parse(process.argv);

  const options = program.opts();
  const configPath = options.config;
  let query = program.args[0];

  printBanner();

  if (!query) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'query',
        message: 'Search MCP servers:',
        validate: input => input.trim().length > 0 ? true : 'Please enter a search query.'
      }
    ]);
    query = answer.query;
  }

  let packages = [];
  try {
    packages = await searchNpmMcpServers(query);
  } catch (err) {
    console.error(pc.red(`Error: ${err.message}`));
    process.exit(1);
  }

  if (packages.length === 0) {
    console.log(pc.yellow(`No MCP servers found matching "${query}".`));
    process.exit(0);
  }

  const choices = packages.map(pkg => ({
    name: `${pc.green(pkg.name)} ${pc.dim(`v${pkg.version}`)} - ${pc.dim(pkg.description)}`,
    value: pkg
  }));

  const { selectedPkg } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedPkg',
      message: 'Select an MCP server to configure:',
      choices,
      pageSize: 10
    }
  ]);

  if (!VALID_NPM_PACKAGE_NAME.test(selectedPkg.name)) {
    console.error(pc.red('Security violation: Selected package name does not match npm package naming specification.'));
    process.exit(1);
  }

  const { executionMethod } = await inquirer.prompt([
    {
      type: 'list',
      name: 'executionMethod',
      message: 'Execution method:',
      choices: [
        {
          name: `${pc.bold('npx')} (Runs on-demand, no local installation footprint)`,
          value: 'npx'
        },
        {
          name: `${pc.bold('npm install -g')} (Installs permanently on system)`,
          value: 'global'
        }
      ]
    }
  ]);

  if (executionMethod === 'global') {
    const spinner = ora(`Running npm install -g ${selectedPkg.name}...`).start();
    try {
      await runCommand('npm', ['install', '-g', selectedPkg.name]);
      spinner.succeed(`Package ${pc.bold(selectedPkg.name)} installed globally.`);
    } catch (err) {
      spinner.fail(pc.red('Global installation failed.'));
      console.error(pc.dim(err.message));

      const { continueAnyway } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: 'Continue adding server configuration anyway?',
          default: false
        }
      ]);

      if (!continueAnyway) {
        process.exit(1);
      }
    }
  }

  const defaultKey = sanitizeServerKey(selectedPkg.name);
  const { serverKey } = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverKey',
      message: 'Server identifier name:',
      default: defaultKey,
      validate: input => {
        const trimmed = input.trim();
        if (!trimmed) return 'Identifier cannot be empty.';
        if (FORBIDDEN_SERVER_KEYS.has(trimmed.toLowerCase())) {
          return `"${trimmed}" is a reserved prototype property and cannot be used.`;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
          return 'Only alphanumeric characters, dashes, and underscores are allowed.';
        }
        return true;
      }
    }
  ]);

  const configSpinner = ora(`Updating ${configPath}...`).start();
  try {
    const configData = await loadOrCreateConfig(configPath);

    if (Object.prototype.hasOwnProperty.call(configData.mcpServers, serverKey)) {
      configSpinner.stop();
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `Server "${serverKey}" already exists in config. Overwrite?`,
          default: true
        }
      ]);
      if (!overwrite) {
        console.log(pc.yellow('Operation cancelled.'));
        process.exit(0);
      }
      configSpinner.start();
    }

    if (executionMethod === 'npx') {
      configData.mcpServers[serverKey] = {
        command: 'npx',
        args: ['-y', selectedPkg.name]
      };
    } else {
      configData.mcpServers[serverKey] = {
        command: selectedPkg.name,
        args: []
      };
    }

    await saveConfig(configPath, configData);
    configSpinner.succeed(pc.green(`Saved to ${configPath}`));

    console.log();
    console.log(pc.bold('Server entry configured:'));
    console.log(pc.white(JSON.stringify({ [serverKey]: configData.mcpServers[serverKey] }, null, 2)));
    console.log(pc.dim('\nAntigravity CLI will detect this server on its next run.\n'));
  } catch (err) {
    configSpinner.fail(pc.red('Failed to update Antigravity config.'));
    console.error(pc.red(`\n${err.message}`));
    process.exit(1);
  }
}

main().catch(err => {
  if (err.name === 'ExitPromptError') {
    console.log(pc.yellow('\nCancelled.'));
    process.exit(0);
  }
  console.error(pc.red(`\nFatal: ${err.message}`));
  process.exit(1);
});
