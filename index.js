#!/usr/bin/env node

/**
 * antigravity-mcp-installer
 * Interactive CLI to search, audit risk, and register MCP servers in Antigravity CLI.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import pc from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
const LOCAL_CONFIG_PATH = path.join(process.cwd(), '.gemini', 'mcp_config.json');

// npm package name standard regex
const VALID_NPM_PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

// Protect against Prototype Pollution
const FORBIDDEN_SERVER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function printBanner() {
  console.log();
  console.log(pc.bold(pc.cyan('antigravity-mcp-installer')) + pc.dim(' (agy-mcp)'));
  console.log(pc.dim('Search, audit risk & configure MCP servers for Antigravity CLI'));
  console.log();
}

/**
 * Safe process execution without shell invocation
 */
function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
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
 * Quick heuristic risk evaluation for search results listing
 */
function evaluateQuickRisk(pkg) {
  const weekly = pkg.downloadsWeekly || 0;
  const hasRepo = Boolean(pkg.hasRepo);
  const isOfficial = pkg.name.startsWith('@modelcontextprotocol/');

  if (isOfficial) {
    return { level: 'LOW', label: pc.green('🟢 Low Risk') };
  }

  if (weekly < 25 && !hasRepo) {
    return { level: 'HIGH', label: pc.red('🔴 High Risk') };
  }

  if (weekly < 100 || !hasRepo) {
    return { level: 'MEDIUM', label: pc.yellow('🟡 Medium Risk') };
  }

  return { level: 'LOW', label: pc.green('🟢 Low Risk') };
}

/**
 * Deep security assessment querying Google OSV vulnerability database & registry stats
 */
async function performSecurityAssessment(pkg) {
  const spinner = ora({
    text: `Auditing security for ${pkg.name} against Google OSV database...`,
    color: 'cyan'
  }).start();

  const signals = [];
  let score = 0; // Higher = riskier
  let activeVulns = [];

  // 1. Query Google OSV API for known CVEs
  try {
    const res = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity-mcp-installer'
      },
      body: JSON.stringify({
        package: {
          name: pkg.name,
          ecosystem: 'npm'
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.vulns) && data.vulns.length > 0) {
        // Check which vulnerabilities might affect current version
        for (const vuln of data.vulns) {
          const vulnId = vuln.aliases?.[0] || vuln.id;
          const severity = vuln.database_specific?.severity || 'MODERATE';
          
          let affected = true;
          // Simple semver fixed check if available
          for (const aff of vuln.affected || []) {
            for (const r of aff.ranges || []) {
              if (r.type === 'SEMVER' && Array.isArray(r.events)) {
                const fixedEv = r.events.find(e => e.fixed);
                if (fixedEv && pkg.version && pkg.version >= fixedEv.fixed) {
                  affected = false;
                }
              }
            }
          }

          if (affected) {
            activeVulns.push(`${vulnId} (${severity}) - ${vuln.summary || 'Security advisory'}`);
            score += severity === 'HIGH' || severity === 'CRITICAL' ? 50 : 25;
          }
        }
      }
    }
  } catch (err) {
    signals.push('Could not reach OSV database (offline or blocked).');
  }

  // 2. Community adoption & provenance
  const weekly = pkg.downloadsWeekly || 0;
  if (pkg.name.startsWith('@modelcontextprotocol/')) {
    signals.push('Official Model Context Protocol package scope');
    score = Math.max(0, score - 20);
  } else if (weekly > 500) {
    signals.push(`High adoption (${weekly.toLocaleString()} weekly downloads)`);
  } else if (weekly < 30) {
    score += 30;
    signals.push(`Low download volume (${weekly} weekly downloads) - minimal community verification`);
  } else {
    score += 10;
    signals.push(`Moderate download volume (${weekly} weekly downloads)`);
  }

  // 3. Source repository provenance
  if (pkg.hasRepo) {
    signals.push(`Source repository: ${pkg.repoUrl}`);
  } else {
    score += 25;
    signals.push('No public source repository link declared in package metadata');
  }

  spinner.stop();

  let level = 'LOW';
  let badge = pc.bold(pc.green('LOW RISK (🟢)'));

  if (activeVulns.length > 0 || score >= 45) {
    level = 'HIGH';
    badge = pc.bold(pc.red('HIGH RISK (🔴)'));
  } else if (score >= 20) {
    level = 'MEDIUM';
    badge = pc.bold(pc.yellow('MEDIUM RISK (🟡)'));
  }

  // Print Assessment Card
  console.log();
  console.log(pc.bold('─'.repeat(65)));
  console.log(` Security Assessment: ${badge}`);
  console.log(pc.bold('─'.repeat(65)));
  
  if (activeVulns.length > 0) {
    console.log(pc.red(` Active Vulnerabilities Found (${activeVulns.length}):`));
    activeVulns.forEach(v => console.log(pc.red(`   • ${v}`)));
  } else {
    console.log(pc.green('   • 0 active vulnerabilities reported in OSV database'));
  }

  signals.forEach(s => console.log(pc.dim(`   • ${s}`)));
  console.log(pc.bold('─'.repeat(65)));
  console.log();

  return { level, activeVulns };
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

    return data.objects
      .filter(item => item?.package?.name && VALID_NPM_PACKAGE_NAME.test(item.package.name))
      .map(item => ({
        name: item.package.name,
        version: item.package.version || '0.0.0',
        description: item.package.description || 'No description available',
        downloadsWeekly: item.downloads?.weekly || 0,
        hasRepo: Boolean(item.package.links?.repository),
        repoUrl: item.package.links?.repository || ''
      }));
  } catch (error) {
    spinner.fail(pc.red('Failed to reach npm registry.'));
    throw error;
  }
}

/**
 * Safely read or create config file
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
    .description('Interactive MCP server installer with security risk audit for Antigravity CLI')
    .version('1.1.0')
    .argument('[query]', 'Search term (e.g. filesystem, postgres, sqlite)')
    .option('-c, --config <path>', 'Explicit path to mcp_config.json')
    .parse(process.argv);

  const options = program.opts();
  let explicitConfigPath = options.config ? path.resolve(options.config) : null;
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

  // 1. Interactive choice list with quick risk indicators
  const choices = packages.map(pkg => {
    const risk = evaluateQuickRisk(pkg);
    const weeklyText = pkg.downloadsWeekly ? pc.dim(` (${pkg.downloadsWeekly.toLocaleString()} dl/wk)`) : '';
    return {
      name: `${pc.bold(pkg.name)} ${pc.dim(`v${pkg.version}`)} [${risk.label}]${weeklyText}\n  ${pc.dim(pkg.description)}`,
      value: pkg
    };
  });

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
    console.error(pc.red('Security violation: Package name violates npm specification.'));
    process.exit(1);
  }

  // 2. Perform Deep Security Risk Audit
  const security = await performSecurityAssessment(selectedPkg);

  if (security.level === 'HIGH' || security.level === 'MEDIUM') {
    const { proceedWithRisk } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceedWithRisk',
        message: security.level === 'HIGH'
          ? '⚠ WARNING: This package has elevated security risks. Proceed anyway?'
          : 'Notice: This package has medium risk warnings. Proceed?',
        default: security.level !== 'HIGH'
      }
    ]);

    if (!proceedWithRisk) {
      console.log(pc.yellow('\nInstallation aborted by user due to security risk.\n'));
      process.exit(0);
    }
  }

  // 3. Selection of Scope: Global vs Privado (Local Project)
  let targetConfigPath = explicitConfigPath;
  if (!targetConfigPath) {
    const { scope } = await inquirer.prompt([
      {
        type: 'list',
        name: 'scope',
        message: '¿Dónde deseas configurar este servidor MCP?',
        choices: [
          {
            name: `${pc.bold('Global')} ${pc.dim(`(Disponible en todos tus proyectos: ${GLOBAL_CONFIG_PATH})`)}`,
            value: 'global'
          },
          {
            name: `${pc.bold('Privado / Local')} ${pc.dim(`(Solo para este repositorio/proyecto: ./.gemini/mcp_config.json)`)}`,
            value: 'local'
          }
        ]
      }
    ]);
    targetConfigPath = scope === 'global' ? GLOBAL_CONFIG_PATH : LOCAL_CONFIG_PATH;
  }

  // 4. Selection of Execution Method: npx vs npm install -g
  const { executionMethod } = await inquirer.prompt([
    {
      type: 'list',
      name: 'executionMethod',
      message: '¿Cómo deseas ejecutarlo?',
      choices: [
        {
          name: `${pc.bold('npx')} ${pc.dim('(Recomendado: se ejecuta bajo demanda sin instalación permanente)')}`,
          value: 'npx'
        },
        {
          name: `${pc.bold('npm install -g')} ${pc.dim('(Instalación global del binario en el sistema)')}`,
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

  // 5. Server identifier name
  const defaultKey = sanitizeServerKey(selectedPkg.name);
  const { serverKey } = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverKey',
      message: 'Identificador del servidor en Antigravity:',
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

  // 6. Update target configuration
  const configSpinner = ora(`Actualizando ${pc.dim(targetConfigPath)}...`).start();
  try {
    const configData = await loadOrCreateConfig(targetConfigPath);

    if (Object.prototype.hasOwnProperty.call(configData.mcpServers, serverKey)) {
      configSpinner.stop();
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `El servidor "${serverKey}" ya existe en la configuración. ¿Sobrescribir?`,
          default: true
        }
      ]);
      if (!overwrite) {
        console.log(pc.yellow('Operación cancelada.'));
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

    await saveConfig(targetConfigPath, configData);
    configSpinner.succeed(pc.green(`Configuración guardada en ${targetConfigPath}`));

    console.log();
    console.log(pc.bold('Servidor MCP configurado exitosamente:'));
    console.log(pc.white(JSON.stringify({ [serverKey]: configData.mcpServers[serverKey] }, null, 2)));
    console.log(pc.dim('\nAntigravity CLI cargará este servidor automáticamente.\n'));
  } catch (err) {
    configSpinner.fail(pc.red('Fallo al actualizar la configuración.'));
    console.error(pc.red(`\n${err.message}`));
    process.exit(1);
  }
}

main().catch(err => {
  if (err.name === 'ExitPromptError') {
    console.log(pc.yellow('\nOperación cancelada.'));
    process.exit(0);
  }
  console.error(pc.red(`\nFatal: ${err.message}`));
  process.exit(1);
});
