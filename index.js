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

// Sentinel value to identify when user requests to go back
const BACK_SIGNAL = Symbol('BACK_SIGNAL');

function printBanner() {
  console.log();
  console.log(pc.bold(pc.cyan('antigravity-mcp-installer')) + pc.dim(' (agy-mcp)'));
  console.log(pc.dim('Search, audit risk & configure MCP servers for Antigravity CLI'));
  console.log(pc.dim('Tip: Press [Esc] at any menu to go back.'));
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
 * Inquirer wrapper with Escape key listener for backward navigation
 */
async function promptWithEsc(questionOrQuestions, allowEsc = true) {
  const promptPromise = inquirer.prompt(questionOrQuestions);
  let keyHandler;

  if (allowEsc && promptPromise.ui?.abortController) {
    keyHandler = (str, key) => {
      if (key && (key.name === 'escape' || key.sequence === '\u001b')) {
        promptPromise.ui.abortController.abort(BACK_SIGNAL);
      }
    };
    process.stdin.on('keypress', keyHandler);
  }

  try {
    return await promptPromise;
  } catch (err) {
    if (err.name === 'AbortPromptError' || promptPromise.ui?.abortController?.signal?.aborted) {
      return BACK_SIGNAL;
    }
    throw err;
  } finally {
    if (keyHandler) {
      process.stdin.removeListener('keypress', keyHandler);
    }
  }
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
  let score = 0;
  let activeVulns = [];

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
        for (const vuln of data.vulns) {
          const vulnId = vuln.aliases?.[0] || vuln.id;
          const severity = vuln.database_specific?.severity || 'MODERATE';
          
          let affected = true;
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
 * Search MCP servers via npm registry API and rank by Term Relevance + Download Popularity
 */
async function searchNpmMcpServers(searchTerm) {
  const sanitizedTerm = searchTerm.trim().replace(/[\r\n\0]/g, '');
  if (!sanitizedTerm) return [];

  const lowerTerm = sanitizedTerm.toLowerCase();

  const spinner = ora({
    text: `Searching npm registry for "${sanitizedTerm}" MCP servers...`,
    color: 'cyan'
  }).start();

  try {
    let query = `${sanitizedTerm} mcp-server`;
    let url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=50`;

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
      url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=50`;
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

    // 1. FILTER: Package must be related to MCP AND match the searched term
    const candidates = data.objects.filter(item => {
      const pkg = item.package;
      if (!pkg?.name || !VALID_NPM_PACKAGE_NAME.test(pkg.name)) return false;

      const name = (pkg.name || '').toLowerCase();
      const desc = (pkg.description || '').toLowerCase();
      const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());

      const matchesTerm = name.includes(lowerTerm) || keywords.some(k => k.includes(lowerTerm)) || desc.includes(lowerTerm);
      const isMcp = name.includes('mcp') || keywords.some(k => k.includes('mcp')) || desc.includes('mcp') || desc.includes('model context protocol');

      return matchesTerm && isMcp;
    });

    // If strict filter yields 0 results (unusual query), fallback to all valid results that mention MCP
    const pool = candidates.length > 0 ? candidates : data.objects.filter(item => {
      const pkg = item.package;
      if (!pkg?.name || !VALID_NPM_PACKAGE_NAME.test(pkg.name)) return false;
      const name = (pkg.name || '').toLowerCase();
      const desc = (pkg.description || '').toLowerCase();
      const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());
      return name.includes('mcp') || keywords.some(k => k.includes('mcp')) || desc.includes('mcp');
    });

    // 2. RELEVANCE + POPULARITY RANKING
    // Ensures packages matching the search term stay at the top, ranked by downloads among peers
    function computeRank(item) {
      const pkg = item.package;
      const name = (pkg.name || '').toLowerCase();
      const desc = (pkg.description || '').toLowerCase();
      const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());
      const weekly = item.downloads?.weekly || 0;

      let score = 0;

      // Tier 1: Package name explicitly contains both search term and 'mcp'
      if (name.includes(lowerTerm) && name.includes('mcp')) {
        score += 10000000;
      }
      // Tier 2: Package name explicitly contains search term
      else if (name.includes(lowerTerm)) {
        score += 5000000;
      }
      // Tier 3: Keywords array explicitly contains search term
      else if (keywords.some(k => k.includes(lowerTerm))) {
        score += 2000000;
      }
      // Tier 4: Description contains search term
      else if (desc.includes(lowerTerm)) {
        score += 1000000;
      }

      // Add popularity within the relevance tier
      score += weekly;
      return score;
    }

    const sortedResults = pool
      .map(item => ({
        name: item.package.name,
        version: item.package.version || '0.0.0',
        description: item.package.description || 'No description available',
        downloadsWeekly: item.downloads?.weekly || 0,
        downloadsMonthly: item.downloads?.monthly || 0,
        hasRepo: Boolean(item.package.links?.repository),
        repoUrl: item.package.links?.repository || '',
        _rank: computeRank(item)
      }))
      .sort((a, b) => b._rank - a._rank);

    return sortedResults;
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
    .description('Interactive MCP server installer with risk audit and smart relevance ranking')
    .version('1.2.1')
    .argument('[query]', 'Search term (e.g. filesystem, postgres, sqlite)')
    .option('-c, --config <path>', 'Explicit path to mcp_config.json')
    .parse(process.argv);

  const options = program.opts();
  const explicitConfigPath = options.config ? path.resolve(options.config) : null;
  let initialArgQuery = program.args[0] || '';

  printBanner();

  let state = 'SEARCH';
  let query = initialArgQuery;
  let packages = [];
  let selectedPkg = null;
  let security = null;
  let targetConfigPath = explicitConfigPath;
  let executionMethod = 'npx';
  let serverKey = '';

  while (state !== 'DONE') {
    switch (state) {
      case 'SEARCH': {
        if (!query) {
          const ans = await promptWithEsc([
            {
              type: 'input',
              name: 'query',
              message: 'Search MCP servers (e.g. github, filesystem, postgres):',
              validate: input => input.trim().length > 0 ? true : 'Please enter a search term.'
            }
          ], false);

          query = ans.query;
        }

        try {
          packages = await searchNpmMcpServers(query);
        } catch (err) {
          console.error(pc.red(`Error: ${err.message}`));
          query = '';
          continue;
        }

        if (packages.length === 0) {
          console.log(pc.yellow(`No MCP servers found for "${query}". Try another keyword.\n`));
          query = '';
          continue;
        }

        state = 'SELECT_PACKAGE';
        break;
      }

      case 'SELECT_PACKAGE': {
        const choices = packages.map(pkg => {
          const risk = evaluateQuickRisk(pkg);
          const dl = pkg.downloadsWeekly ? pc.cyan(`🔥 ${pkg.downloadsWeekly.toLocaleString()} dl/wk`) : pc.dim('0 dl/wk');
          return {
            name: `${pc.bold(pkg.name)} ${pc.dim(`v${pkg.version}`)} [${risk.label}] [${dl}]\n  ${pc.dim(pkg.description)}`,
            value: pkg
          };
        });

        choices.push(new inquirer.Separator());
        choices.push({
          name: pc.dim('← [Esc] Volver a buscar con otro término'),
          value: BACK_SIGNAL
        });

        const ans = await promptWithEsc([
          {
            type: 'list',
            name: 'selected',
            message: `Select an MCP server for "${query}" (${packages.length} found, ranked by relevance & downloads):`,
            choices,
            pageSize: 10
          }
        ]);

        if (ans === BACK_SIGNAL || ans.selected === BACK_SIGNAL) {
          query = '';
          state = 'SEARCH';
          break;
        }

        selectedPkg = ans.selected;
        state = 'AUDIT_RISK';
        break;
      }

      case 'AUDIT_RISK': {
        security = await performSecurityAssessment(selectedPkg);

        if (security.level === 'HIGH' || security.level === 'MEDIUM') {
          const ans = await promptWithEsc([
            {
              type: 'list',
              name: 'action',
              message: security.level === 'HIGH'
                ? '⚠ WARNING: This server has elevated security warnings. What would you like to do?'
                : 'Notice: This server has moderate security notes. What would you like to do?',
              choices: [
                { name: 'Proceed with configuration', value: 'proceed' },
                { name: '← [Esc] Volver a la lista de servidores', value: 'back' }
              ]
            }
          ]);

          if (ans === BACK_SIGNAL || ans.action === 'back') {
            state = 'SELECT_PACKAGE';
            break;
          }
        }

        state = explicitConfigPath ? 'SELECT_EXECUTION' : 'SELECT_SCOPE';
        break;
      }

      case 'SELECT_SCOPE': {
        const ans = await promptWithEsc([
          {
            type: 'list',
            name: 'scope',
            message: '¿Dónde deseas configurar este servidor MCP?',
            choices: [
              {
                name: `${pc.bold('Global')} ${pc.dim(`(Para todos tus proyectos: ${GLOBAL_CONFIG_PATH})`)}`,
                value: 'global'
              },
              {
                name: `${pc.bold('Privado / Local')} ${pc.dim(`(Solo para este repositorio: ./.gemini/mcp_config.json)`)}`,
                value: 'local'
              },
              new inquirer.Separator(),
              {
                name: pc.dim('← [Esc] Volver'),
                value: BACK_SIGNAL
              }
            ]
          }
        ]);

        if (ans === BACK_SIGNAL || ans.scope === BACK_SIGNAL) {
          state = 'SELECT_PACKAGE';
          break;
        }

        targetConfigPath = ans.scope === 'global' ? GLOBAL_CONFIG_PATH : LOCAL_CONFIG_PATH;
        state = 'SELECT_EXECUTION';
        break;
      }

      case 'SELECT_EXECUTION': {
        const ans = await promptWithEsc([
          {
            type: 'list',
            name: 'method',
            message: '¿Cómo deseas ejecutar este servidor MCP?',
            choices: [
              {
                name: `${pc.bold('npx')} ${pc.dim('(Recomendado: bajo demanda, sin ensuciar el sistema)')}`,
                value: 'npx'
              },
              {
                name: `${pc.bold('npm install -g')} ${pc.dim('(Instalación global del binario en el sistema)')}`,
                value: 'global'
              },
              new inquirer.Separator(),
              {
                name: pc.dim('← [Esc] Volver'),
                value: BACK_SIGNAL
              }
            ]
          }
        ]);

        if (ans === BACK_SIGNAL || ans.method === BACK_SIGNAL) {
          state = explicitConfigPath ? 'SELECT_PACKAGE' : 'SELECT_SCOPE';
          break;
        }

        executionMethod = ans.method;

        if (executionMethod === 'global') {
          const spinner = ora(`Instalando ${selectedPkg.name} globalmente con npm...`).start();
          try {
            await runCommand('npm', ['install', '-g', selectedPkg.name]);
            spinner.succeed(`Paquete ${pc.bold(selectedPkg.name)} instalado globalmente.`);
          } catch (err) {
            spinner.fail(pc.red('Fallo al instalar globalmente con npm.'));
            console.error(pc.dim(err.message));

            const fallback = await promptWithEsc([
              {
                type: 'confirm',
                name: 'continueAnyway',
                message: 'La instalación global falló. ¿Deseas continuar configurándolo de todas formas?',
                default: false
              }
            ]);

            if (fallback === BACK_SIGNAL || !fallback.continueAnyway) {
              state = 'SELECT_EXECUTION';
              break;
            }
          }
        }

        state = 'SET_KEY';
        break;
      }

      case 'SET_KEY': {
        const defaultKey = sanitizeServerKey(selectedPkg.name);
        const ans = await promptWithEsc([
          {
            type: 'input',
            name: 'serverKey',
            message: 'Identificador para el servidor en Antigravity (o presiona [Esc] para volver):',
            default: defaultKey,
            validate: input => {
              const trimmed = input.trim();
              if (!trimmed) return 'Identifier cannot be empty.';
              if (FORBIDDEN_SERVER_KEYS.has(trimmed.toLowerCase())) {
                return `"${trimmed}" is a reserved property name.`;
              }
              if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
                return 'Solo se permiten caracteres alfanuméricos, guiones y guiones bajos.';
              }
              return true;
            }
          }
        ]);

        if (ans === BACK_SIGNAL) {
          state = 'SELECT_EXECUTION';
          break;
        }

        serverKey = ans.serverKey;
        state = 'SAVE';
        break;
      }

      case 'SAVE': {
        const configSpinner = ora(`Actualizando ${pc.dim(targetConfigPath)}...`).start();
        try {
          const configData = await loadOrCreateConfig(targetConfigPath);

          if (Object.prototype.hasOwnProperty.call(configData.mcpServers, serverKey)) {
            configSpinner.stop();
            const overwriteAns = await promptWithEsc([
              {
                type: 'confirm',
                name: 'overwrite',
                message: `El servidor "${serverKey}" ya existe en la configuración. ¿Sobrescribir?`,
                default: true
              }
            ]);

            if (overwriteAns === BACK_SIGNAL || !overwriteAns.overwrite) {
              console.log(pc.yellow('Operación de sobrescritura cancelada.'));
              state = 'SET_KEY';
              break;
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
          state = 'DONE';
        } catch (err) {
          configSpinner.fail(pc.red('Fallo al actualizar la configuración.'));
          console.error(pc.red(`\n${err.message}`));
          process.exit(1);
        }
        break;
      }
    }
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
