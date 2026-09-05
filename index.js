#!/usr/bin/env node

/**
 * antigravity-mcp-installer
 * Interactive CLI to search, explain, audit risk, configure and manage MCP servers for Antigravity CLI.
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

// Handle Ctrl+C (SIGINT) cleanly
function handleExit() {
  console.log(pc.yellow('\n\nOperation cancelled by user.'));
  process.exit(0);
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', () => process.exit(0));

function printBanner() {
  console.log();
  console.log(pc.bold(pc.cyan('antigravity-mcp-installer')) + pc.dim(' (agy-mcp)'));
  console.log(pc.dim('Search, audit, configure & manage MCP servers for Antigravity CLI'));
  console.log(pc.dim('Tip: Press [Esc] to go back, or [Ctrl+C] to exit.'));
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
 * Inquirer wrapper with Escape key for backward navigation & strict Ctrl+C exit
 */
async function promptWithEsc(questionOrQuestions, allowEsc = true) {
  const promptPromise = inquirer.prompt(questionOrQuestions);
  let keyHandler;

  if (promptPromise.ui?.abortController) {
    keyHandler = (str, key) => {
      if (key && key.ctrl && key.name === 'c') {
        handleExit();
      }
      if (allowEsc && key && (key.name === 'escape' || key.sequence === '\u001b')) {
        promptPromise.ui.abortController.abort(BACK_SIGNAL);
      }
    };
    process.stdin.on('keypress', keyHandler);
  }

  try {
    return await promptPromise;
  } catch (err) {
    if (err.name === 'ExitPromptError') {
      handleExit();
    }

    if (promptPromise.ui?.abortController?.signal?.reason === BACK_SIGNAL) {
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
 * Safely read or create config file, with auto-recovery for empty or corrupted files
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
    if (!rawData.trim()) {
      const initialConfig = { mcpServers: {} };
      await fs.writeFile(normalizedPath, JSON.stringify(initialConfig, null, 2) + '\n', 'utf-8');
      return initialConfig;
    }

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
      const backupPath = `${normalizedPath}.corrupted.${Date.now()}.bak`;
      try { await fs.copyFile(normalizedPath, backupPath); } catch {}
      console.log(pc.yellow(`\nNotice: Corrupted JSON detected in ${normalizedPath}. Backed up to ${backupPath} and initialized clean config.`));
      const initialConfig = { mcpServers: {} };
      await fs.writeFile(normalizedPath, JSON.stringify(initialConfig, null, 2) + '\n', 'utf-8');
      return initialConfig;
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

/**
 * Extract target npm package name from server configuration
 */
function getPackageNameFromConfig(serverConfig) {
  if (!serverConfig) return '';
  if (serverConfig.command === 'npx' && Array.isArray(serverConfig.args)) {
    return serverConfig.args.find(a => !a.startsWith('-')) || '';
  }
  return serverConfig.command || '';
}

/**
 * Automatically detect required environment variables or API keys from README
 */
function detectRequiredEnvVars(readmeText) {
  if (!readmeText) return [];
  const found = new Set();

  // Match typical uppercase env var patterns (e.g. BRAVE_API_KEY, GITHUB_TOKEN, POSTGRES_URL)
  const matches = readmeText.match(/\b([A-Z0-9_]{2,}_(?:KEY|TOKEN|SECRET|URL|API|PASSWORD|PAT|ID|AUTH))\b/g);
  if (matches) {
    const ignored = new Set(['API_KEY', 'SECRET_KEY', 'YOUR_API_KEY', 'YOUR_TOKEN', 'ACCESS_TOKEN', 'BEARER_TOKEN']);
    matches.forEach(m => {
      if (!ignored.has(m) && m.length < 40) {
        found.add(m);
      }
    });
  }

  // Match JSON env block in README (e.g. "env": { "FOO": ... })
  const envBlockRegex = /"env"\s*:\s*\{([^}]+)\}/gi;
  let match;
  while ((match = envBlockRegex.exec(readmeText)) !== null) {
    const keys = match[1].match(/"([A-Z0-9_]+)"\s*:/g);
    if (keys) {
      keys.forEach(k => found.add(k.replace(/[" :]/g, '')));
    }
  }

  return Array.from(found).slice(0, 8);
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
 * Parse and extract bullet capabilities from package README
 */
function extractCapabilities(readmeText) {
  if (!readmeText) return [];
  const lines = readmeText.split('\n');
  let capturing = false;
  const capabilities = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,3}\s+.*?(features|tools|capabilities|operations|overview|about)/i.test(trimmed)) {
      capturing = true;
      continue;
    }
    if (capturing) {
      if (/^#{1,2}\s+/.test(trimmed)) {
        break;
      }
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        const clean = trimmed
          .replace(/^[-*]\s*/, '')
          .replace(/\*\*/g, '')
          .replace(/`([^`]+)`/g, '$1')
          .trim();
        if (clean && clean.length > 5 && capabilities.length < 5) {
          capabilities.push(clean);
        }
      }
    }
  }
  return capabilities;
}

/**
 * Query Google OSV API for vulnerabilities of a package
 */
async function queryOsvVulnerabilities(packageName, currentVersion = null) {
  if (!packageName) return { vulns: [], activeVulns: [] };

  try {
    const res = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity-mcp-installer'
      },
      body: JSON.stringify({
        package: {
          name: packageName,
          ecosystem: 'npm'
        }
      })
    });

    if (!res.ok) return { vulns: [], activeVulns: [] };

    const data = await res.json();
    const vulns = Array.isArray(data.vulns) ? data.vulns : [];
    const activeVulns = [];

    for (const vuln of vulns) {
      const vulnId = vuln.aliases?.[0] || vuln.id;
      const severity = vuln.database_specific?.severity || 'MODERATE';
      let affected = true;

      if (currentVersion) {
        for (const aff of vuln.affected || []) {
          for (const r of aff.ranges || []) {
            if (r.type === 'SEMVER' && Array.isArray(r.events)) {
              const fixedEv = r.events.find(e => e.fixed);
              if (fixedEv && currentVersion >= fixedEv.fixed) {
                affected = false;
              }
            }
          }
        }
      }

      if (affected) {
        activeVulns.push(`${vulnId} (${severity}) - ${vuln.summary || 'Security advisory'}`);
      }
    }

    return { vulns, activeVulns };
  } catch {
    return { vulns: [], activeVulns: [] };
  }
}

/**
 * Fetch package explanation, audit security, and detect required environment variables in parallel
 */
async function fetchExplanationAndSecurity(pkg) {
  const spinner = ora({
    text: `Fetching details and auditing security for ${pc.bold(pkg.name)}...`,
    color: 'cyan'
  }).start();

  const signals = [];
  let score = 0;
  let fullDescription = pkg.description;
  let capabilities = [];
  let detectedEnvVars = [];
  let docsUrl = pkg.repoUrl || '';

  const [osvData, npmResult] = await Promise.all([
    queryOsvVulnerabilities(pkg.name, pkg.version),
    fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'antigravity-mcp-installer' }
    }).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);

  if (npmResult) {
    if (npmResult.description) fullDescription = npmResult.description;
    if (npmResult.homepage) docsUrl = npmResult.homepage;
    if (npmResult.readme) {
      capabilities = extractCapabilities(npmResult.readme);
      detectedEnvVars = detectRequiredEnvVars(npmResult.readme);
    }
  }

  const activeVulns = osvData.activeVulns;
  if (activeVulns.length > 0) {
    score += 50;
  }

  const weekly = pkg.downloadsWeekly || 0;
  if (pkg.name.startsWith('@modelcontextprotocol/')) {
    signals.push('Official Model Context Protocol scope package');
    score = Math.max(0, score - 20);
  } else if (weekly > 500) {
    signals.push(`High community adoption (${weekly.toLocaleString()} dl/week)`);
  } else if (weekly < 30) {
    score += 30;
    signals.push(`Low download volume (${weekly} dl/week)`);
  } else {
    score += 10;
    signals.push(`Moderate adoption (${weekly} dl/week)`);
  }

  if (pkg.hasRepo) {
    signals.push(`Public repository: ${pkg.repoUrl}`);
  } else {
    score += 25;
    signals.push('No public source repository declared in npm metadata');
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
  console.log(pc.bold(pc.cyan('═'.repeat(68))));
  console.log(` 📦 ${pc.bold(pkg.name)} ${pc.dim(`(v${pkg.version})`)}`);
  console.log(pc.bold(pc.cyan('─'.repeat(68))));

  console.log(pc.bold(' 📖 What does this MCP server do?'));
  console.log(pc.white(`   ${fullDescription}`));

  if (capabilities.length > 0) {
    console.log();
    console.log(pc.bold(' 🛠️  Key Capabilities & Tools:'));
    capabilities.forEach(cap => console.log(`   • ${pc.cyan(cap)}`));
  }

  if (detectedEnvVars.length > 0) {
    console.log();
    console.log(pc.bold(' 🔑 Detected Environment Variable / API Key requirements:'));
    detectedEnvVars.forEach(env => console.log(`   • ${pc.yellow(env)}`));
  }

  if (docsUrl) {
    console.log();
    console.log(pc.dim(` 🌐 Documentation / Repo: ${docsUrl}`));
  }

  console.log(pc.bold(pc.cyan('─'.repeat(68))));
  console.log(` 🛡️  Security Risk Assessment: ${badge}`);
  console.log(pc.bold(pc.cyan('─'.repeat(68))));

  if (activeVulns.length > 0) {
    console.log(pc.red(` ⚠ Active vulnerabilities found (${activeVulns.length}):`));
    activeVulns.forEach(v => console.log(pc.red(`   • ${v}`)));
  } else {
    console.log(pc.green('   • 0 known vulnerabilities in Google OSV database'));
  }

  signals.forEach(s => console.log(pc.dim(`   • ${s}`)));
  console.log(pc.bold(pc.cyan('═'.repeat(68))));
  console.log();

  return { level, activeVulns, fullDescription, capabilities, detectedEnvVars };
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
      spinner.text = 'Broadening search...';
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

    const pool = candidates.length > 0 ? candidates : data.objects.filter(item => {
      const pkg = item.package;
      if (!pkg?.name || !VALID_NPM_PACKAGE_NAME.test(pkg.name)) return false;
      const name = (pkg.name || '').toLowerCase();
      const desc = (pkg.description || '').toLowerCase();
      const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());
      return name.includes('mcp') || keywords.some(k => k.includes('mcp')) || desc.includes('mcp');
    });

    function computeRank(item) {
      const pkg = item.package;
      const name = (pkg.name || '').toLowerCase();
      const desc = (pkg.description || '').toLowerCase();
      const keywords = (pkg.keywords || []).map(k => String(k).toLowerCase());
      const weekly = item.downloads?.weekly || 0;

      let score = 0;

      if (name.includes(lowerTerm) && name.includes('mcp')) {
        score += 10000000;
      } else if (name.includes(lowerTerm)) {
        score += 5000000;
      } else if (keywords.some(k => k.includes(lowerTerm))) {
        score += 2000000;
      } else if (desc.includes(lowerTerm)) {
        score += 1000000;
      }

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
 * Manage existing MCP servers module with full Esc back navigation
 */
async function manageExistingServers(explicitPath = null) {
  let manageScope = explicitPath;

  while (true) {
    if (!explicitPath) {
      const scopeAns = await promptWithEsc([
        {
          type: 'list',
          name: 'scope',
          message: 'Select configuration scope to manage:',
          choices: [
            {
              name: `${pc.bold('Global')} ${pc.dim(`(${GLOBAL_CONFIG_PATH})`)}`,
              value: GLOBAL_CONFIG_PATH
            },
            {
              name: `${pc.bold('Local / Project')} ${pc.dim(`(${LOCAL_CONFIG_PATH})`)}`,
              value: LOCAL_CONFIG_PATH
            },
            new inquirer.Separator(),
            {
              name: pc.dim('← [Esc] Back to main menu'),
              value: BACK_SIGNAL
            }
          ]
        }
      ]);

      if (scopeAns === BACK_SIGNAL || scopeAns.scope === BACK_SIGNAL) {
        return;
      }
      manageScope = scopeAns.scope;
    }

    let inScopeLoop = true;
    while (inScopeLoop) {
      const configData = await loadOrCreateConfig(manageScope);
      const serverKeys = Object.keys(configData.mcpServers || {});

      if (serverKeys.length === 0) {
        console.log(pc.yellow(`\nNo MCP servers configured in ${manageScope}.\n`));
        if (explicitPath) return;
        inScopeLoop = false;
        break;
      }

      const spinner = ora({
        text: `Auditing vulnerabilities for ${serverKeys.length} server(s) in ${path.basename(manageScope)}...`,
        color: 'cyan'
      }).start();

      const auditResults = {};
      await Promise.all(
        serverKeys.map(async key => {
          const server = configData.mcpServers[key];
          const pkgName = getPackageNameFromConfig(server);
          const osv = await queryOsvVulnerabilities(pkgName);
          auditResults[key] = { pkgName, vulns: osv.vulns, activeVulns: osv.activeVulns };
        })
      );
      spinner.stop();

      const choices = serverKeys.map(key => {
        const s = configData.mcpServers[key];
        const audit = auditResults[key];
        const cmdPreview = `${s.command || ''} ${(s.args || []).join(' ')}`.trim();
        
        let badge = pc.green('[🟢 Safe]');
        if (audit.activeVulns.length > 0) {
          badge = pc.bold(pc.red(`[🔴 ${audit.activeVulns.length} CVEs!]`));
        }

        const envCount = s.env ? Object.keys(s.env).length : 0;
        const envBadge = envCount > 0 ? pc.yellow(` [🔑 ${envCount} env]`) : '';

        return {
          name: `${pc.bold(key)} ${badge}${envBadge} ${pc.dim(`(${cmdPreview})`)}`,
          value: key
        };
      });

      choices.push(new inquirer.Separator());
      choices.push({
        name: pc.dim(explicitPath ? '← [Esc] Exit' : '← [Esc] Back to scope selection'),
        value: BACK_SIGNAL
      });

      const selectAns = await promptWithEsc([
        {
          type: 'list',
          name: 'serverKey',
          message: `Configured MCP servers in ${pc.cyan(manageScope)} (${serverKeys.length}):`,
          choices,
          pageSize: 12
        }
      ]);

      if (selectAns === BACK_SIGNAL || selectAns.serverKey === BACK_SIGNAL) {
        if (explicitPath) return;
        inScopeLoop = false;
        break;
      }

      const key = selectAns.serverKey;
      const serverConfig = configData.mcpServers[key];
      const audit = auditResults[key];

      console.log();
      console.log(pc.bold(pc.cyan('═'.repeat(68))));
      console.log(` ⚙️  MCP Server: ${pc.bold(pc.green(key))}`);
      console.log(pc.bold(pc.cyan('─'.repeat(68))));
      console.log(`  • Config File : ${pc.white(manageScope)}`);
      console.log(`  • Command     : ${pc.white(serverConfig.command || 'none')}`);
      console.log(`  • Arguments   : ${pc.white(JSON.stringify(serverConfig.args || []))}`);
      
      if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
        console.log(`  • Environment Variables / API Keys:`);
        for (const [envK, envV] of Object.entries(serverConfig.env)) {
          const masked = String(envV).length > 6 ? String(envV).slice(0, 3) + '••••••••' + String(envV).slice(-3) : '••••••••';
          console.log(`      ${pc.yellow(envK)} = ${pc.dim(masked)}`);
        }
      } else {
        console.log(`  • Environment : ${pc.dim('None configured')}`);
      }

      console.log(`  • Package     : ${pc.cyan(audit.pkgName || 'custom')}`);
      console.log(pc.bold(pc.cyan('─'.repeat(68))));

      if (audit.activeVulns.length > 0) {
        console.log(pc.red(` ⚠ Security Vulnerabilities (${audit.activeVulns.length}):`));
        audit.activeVulns.forEach(v => console.log(pc.red(`    • ${v}`)));
      } else {
        console.log(pc.green(` ✔ Security Status: No active CVEs reported in Google OSV database.`));
      }
      console.log(pc.bold(pc.cyan('═'.repeat(68))));
      console.log();

      const actionAns = await promptWithEsc([
        {
          type: 'list',
          name: 'action',
          message: `Manage "${key}":`,
          choices: [
            {
              name: `${pc.bold('🔑 Add / Edit Environment Variables (API Keys)')}`,
              value: 'edit_env'
            },
            {
              name: `${pc.bold(pc.red('🗑️  Remove server'))} ${pc.dim('(Delete from configuration)')}`,
              value: 'remove'
            },
            {
              name: pc.dim('← [Esc] Back to servers list'),
              value: BACK_SIGNAL
            }
          ]
        }
      ]);

      if (actionAns === BACK_SIGNAL || actionAns.action === BACK_SIGNAL) {
        continue;
      }

      if (actionAns.action === 'edit_env') {
        serverConfig.env = serverConfig.env || {};
        const varNameAns = await promptWithEsc([
          {
            type: 'input',
            name: 'varName',
            message: 'Environment Variable name (e.g. BRAVE_API_KEY, GITHUB_TOKEN):',
            validate: input => /^[A-Z0-9_]+$/i.test(input.trim()) ? true : 'Use alphanumeric characters and underscores.'
          }
        ]);

        if (varNameAns !== BACK_SIGNAL && varNameAns.varName) {
          const varName = varNameAns.varName.trim().toUpperCase();
          const varValAns = await promptWithEsc([
            {
              type: 'input',
              name: 'varVal',
              message: `Enter value for ${pc.yellow(varName)}:`,
              default: serverConfig.env[varName] || ''
            }
          ]);

          if (varValAns !== BACK_SIGNAL) {
            serverConfig.env[varName] = varValAns.varVal.trim();
            await saveConfig(manageScope, configData);
            console.log(pc.green(`\n✔ Saved ${varName} to "${key}" environment configuration.\n`));
          }
        }
      }

      if (actionAns.action === 'remove') {
        const confirmAns = await promptWithEsc([
          {
            type: 'confirm',
            name: 'confirmRemove',
            message: `Are you sure you want to delete "${key}" from ${manageScope}?`,
            default: false
          }
        ]);

        if (confirmAns !== BACK_SIGNAL && confirmAns.confirmRemove) {
          delete configData.mcpServers[key];
          await saveConfig(manageScope, configData);
          console.log(pc.green(`\n✔ Server "${key}" was successfully removed from ${manageScope}.\n`));
        } else {
          console.log(pc.yellow('\nRemoval cancelled.\n'));
        }
      }
    }

    if (explicitPath) return;
  }
}

/**
 * Scan all installed servers across Global and Local configs
 */
async function auditAllInstalledServers() {
  console.log(pc.bold('\nAuditing all configured MCP servers against Google OSV database...\n'));

  const paths = [
    { label: 'Global', path: GLOBAL_CONFIG_PATH },
    { label: 'Local', path: LOCAL_CONFIG_PATH }
  ];

  let totalScanned = 0;
  let totalIssues = 0;

  for (const item of paths) {
    try {
      const data = await loadOrCreateConfig(item.path);
      const keys = Object.keys(data.mcpServers || {});

      if (keys.length === 0) continue;

      console.log(pc.bold(pc.cyan(`── ${item.label} Configuration (${item.path}) ──`)));

      for (const key of keys) {
        totalScanned++;
        const s = data.mcpServers[key];
        const pkgName = getPackageNameFromConfig(s);
        const { activeVulns } = await queryOsvVulnerabilities(pkgName);

        if (activeVulns.length > 0) {
          totalIssues += activeVulns.length;
          console.log(` ${pc.bold(pc.red('✖'))} ${pc.bold(key)} (${pkgName}): ${pc.red(`${activeVulns.length} vulnerabilities detected!`)}`);
          activeVulns.forEach(v => console.log(pc.red(`     • ${v}`)));
        } else {
          console.log(` ${pc.bold(pc.green('✔'))} ${pc.bold(key)} (${pkgName || s.command}): ${pc.green('No active CVEs')}`);
        }
      }
      console.log();
    } catch {}
  }

  if (totalScanned === 0) {
    console.log(pc.yellow('No MCP servers currently installed in Global or Local configs.\n'));
  } else {
    console.log(pc.bold('─'.repeat(50)));
    if (totalIssues === 0) {
      console.log(pc.bold(pc.green(`All ${totalScanned} installed MCP servers are safe and clear of known CVEs! 🎉\n`)));
    } else {
      console.log(pc.bold(pc.red(`Audit complete: Found ${totalIssues} active vulnerability notices across ${totalScanned} servers.\n`)));
    }
  }

  await promptWithEsc([
    {
      type: 'list',
      name: 'continue',
      message: 'Audit complete. Return to main menu?',
      choices: [{ name: '← [Esc / Enter] Back to main menu', value: true }]
    }
  ]);
}

/**
 * Search and Install Wizard
 */
async function runSearchAndInstallWizard(initialQuery = '', explicitConfigPath = null) {
  let state = 'SEARCH';
  let query = initialQuery;
  let packages = [];
  let selectedPkg = null;
  let security = null;
  let targetConfigPath = explicitConfigPath;
  let executionMethod = 'npx';
  let serverKey = '';
  let serverEnv = {};

  while (state !== 'DONE') {
    switch (state) {
      case 'SEARCH': {
        if (!query) {
          const ans = await promptWithEsc([
            {
              type: 'input',
              name: 'query',
              message: 'What MCP server are you looking for? (e.g. github, postgres, filesystem):',
              validate: input => input.trim().length > 0 ? true : 'Please enter a search term.'
            }
          ], true);

          if (ans === BACK_SIGNAL) {
            return;
          }

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
          name: pc.dim('← [Esc] Search again with a different term'),
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
        security = await fetchExplanationAndSecurity(selectedPkg);

        const choices = [
          { name: pc.bold('Proceed with configuration'), value: 'proceed' },
          { name: pc.dim('← [Esc] Back to server list'), value: 'back' }
        ];

        let msg = 'Do you want to configure this MCP server?';
        if (security.level === 'HIGH') {
          msg = pc.red('⚠ WARNING: This server has elevated security warnings. What would you like to do?');
        } else if (security.level === 'MEDIUM') {
          msg = pc.yellow('Notice: This server has moderate security notes. What would you like to do?');
        }

        const ans = await promptWithEsc([
          {
            type: 'list',
            name: 'action',
            message: msg,
            choices
          }
        ]);

        if (ans === BACK_SIGNAL || ans.action === 'back') {
          state = 'SELECT_PACKAGE';
          break;
        }

        state = explicitConfigPath ? 'SELECT_EXECUTION' : 'SELECT_SCOPE';
        break;
      }

      case 'SELECT_SCOPE': {
        const ans = await promptWithEsc([
          {
            type: 'list',
            name: 'scope',
            message: 'Where do you want to configure this MCP server?',
            choices: [
              {
                name: `${pc.bold('Global')} ${pc.dim(`(Available across all your projects: ${GLOBAL_CONFIG_PATH})`)}`,
                value: 'global'
              },
              {
                name: `${pc.bold('Private / Local')} ${pc.dim(`(Exclusive to this repository: ./.gemini/mcp_config.json)`)}`,
                value: 'local'
              },
              new inquirer.Separator(),
              {
                name: pc.dim('← [Esc] Back'),
                value: BACK_SIGNAL
              }
            ]
          }
        ]);

        if (ans === BACK_SIGNAL || ans.scope === BACK_SIGNAL) {
          state = 'AUDIT_RISK';
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
            message: 'How do you want to run this MCP server?',
            choices: [
              {
                name: `${pc.bold('npx')} ${pc.dim('(Recommended: on-demand execution, zero system clutter)')}`,
                value: 'npx'
              },
              {
                name: `${pc.bold('npm install -g')} ${pc.dim('(Permanent global binary installation on system)')}`,
                value: 'global'
              },
              new inquirer.Separator(),
              {
                name: pc.dim('← [Esc] Back'),
                value: BACK_SIGNAL
              }
            ]
          }
        ]);

        if (ans === BACK_SIGNAL || ans.method === BACK_SIGNAL) {
          state = explicitConfigPath ? 'AUDIT_RISK' : 'SELECT_SCOPE';
          break;
        }

        executionMethod = ans.method;

        if (executionMethod === 'global') {
          const spinner = ora(`Installing ${selectedPkg.name} globally via npm...`).start();
          try {
            await runCommand('npm', ['install', '-g', selectedPkg.name]);
            spinner.succeed(`Package ${pc.bold(selectedPkg.name)} installed globally.`);
          } catch (err) {
            spinner.fail(pc.red('Global installation via npm failed.'));
            console.error(pc.dim(err.message));

            const fallback = await promptWithEsc([
              {
                type: 'confirm',
                name: 'continueAnyway',
                message: 'Global installation failed. Do you want to continue configuring it anyway?',
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
            message: 'Server identifier name in Antigravity (or press [Esc] to go back):',
            default: defaultKey,
            validate: input => {
              const trimmed = input.trim();
              if (!trimmed) return 'Identifier cannot be empty.';
              if (FORBIDDEN_SERVER_KEYS.has(trimmed.toLowerCase())) {
                return `"${trimmed}" is a reserved property name.`;
              }
              if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
                return 'Only alphanumeric characters, dashes, and underscores are allowed.';
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
        state = 'CONFIGURE_ENV';
        break;
      }

      case 'CONFIGURE_ENV': {
        serverEnv = {};
        const detected = security?.detectedEnvVars || [];

        let promptEnv = false;
        if (detected.length > 0) {
          console.log();
          console.log(pc.yellow(`💡 This MCP server recommends the following API keys / environment variables:`));
          detected.forEach(v => console.log(pc.yellow(`   • ${v}`)));
          console.log();

          const envConfirmAns = await promptWithEsc([
            {
              type: 'confirm',
              name: 'configureNow',
              message: 'Do you want to provide values for API keys / environment variables now?',
              default: true
            }
          ]);

          if (envConfirmAns === BACK_SIGNAL) {
            state = 'SET_KEY';
            break;
          }
          promptEnv = envConfirmAns.configureNow;
        } else {
          const envOptionalAns = await promptWithEsc([
            {
              type: 'confirm',
              name: 'needsEnv',
              message: 'Does this MCP server require any API keys or environment variables?',
              default: false
            }
          ]);

          if (envOptionalAns === BACK_SIGNAL) {
            state = 'SET_KEY';
            break;
          }
          promptEnv = envOptionalAns.needsEnv;
        }

        if (promptEnv) {
          // Fill detected variables first
          for (const envName of detected) {
            const valAns = await promptWithEsc([
              {
                type: 'input',
                name: 'val',
                message: `Enter value for ${pc.cyan(envName)} (leave blank to skip):`
              }
            ]);

            if (valAns === BACK_SIGNAL) {
              state = 'SET_KEY';
              break;
            }
            if (valAns.val && valAns.val.trim()) {
              serverEnv[envName] = valAns.val.trim();
            }
          }

          // Custom extra variables
          let addingCustom = true;
          while (addingCustom) {
            const addMoreAns = await promptWithEsc([
              {
                type: 'confirm',
                name: 'addAnother',
                message: 'Add an additional custom environment variable / API key?',
                default: false
              }
            ]);

            if (addMoreAns === BACK_SIGNAL || !addMoreAns.addAnother) {
              addingCustom = false;
              break;
            }

            const customNameAns = await promptWithEsc([
              {
                type: 'input',
                name: 'name',
                message: 'Variable name (e.g. OPENAI_API_KEY, DATABASE_URL):',
                validate: input => /^[A-Z0-9_]+$/i.test(input.trim()) ? true : 'Use alphanumeric characters and underscores.'
              }
            ]);

            if (customNameAns === BACK_SIGNAL || !customNameAns.name) {
              break;
            }

            const cName = customNameAns.name.trim().toUpperCase();
            const customValAns = await promptWithEsc([
              {
                type: 'input',
                name: 'val',
                message: `Enter value for ${pc.cyan(cName)}:`
              }
            ]);

            if (customValAns === BACK_SIGNAL) {
              break;
            }

            if (customValAns.val && customValAns.val.trim()) {
              serverEnv[cName] = customValAns.val.trim();
            }
          }
        }

        state = 'SAVE';
        break;
      }

      case 'SAVE': {
        const configSpinner = ora(`Updating ${pc.dim(targetConfigPath)}...`).start();
        try {
          const configData = await loadOrCreateConfig(targetConfigPath);

          if (Object.prototype.hasOwnProperty.call(configData.mcpServers, serverKey)) {
            configSpinner.stop();
            const overwriteAns = await promptWithEsc([
              {
                type: 'confirm',
                name: 'overwrite',
                message: `Server "${serverKey}" already exists in config. Overwrite?`,
                default: true
              }
            ]);

            if (overwriteAns === BACK_SIGNAL || !overwriteAns.overwrite) {
              console.log(pc.yellow('Overwrite operation cancelled.'));
              state = 'SET_KEY';
              break;
            }
            configSpinner.start();
          }

          const entry = {
            command: executionMethod === 'npx' ? 'npx' : selectedPkg.name,
            args: executionMethod === 'npx' ? ['-y', selectedPkg.name] : []
          };

          if (Object.keys(serverEnv).length > 0) {
            entry.env = serverEnv;
          }

          configData.mcpServers[serverKey] = entry;

          await saveConfig(targetConfigPath, configData);
          configSpinner.succeed(pc.green(`Config saved to ${targetConfigPath}`));

          console.log();
          console.log(pc.bold('MCP server configured successfully:'));
          console.log(pc.white(JSON.stringify({ [serverKey]: configData.mcpServers[serverKey] }, null, 2)));
          console.log(pc.dim('\nAntigravity CLI will detect and load this server automatically.\n'));
          state = 'DONE';
        } catch (err) {
          configSpinner.fail(pc.red('Failed to update Antigravity config.'));
          console.error(pc.red(`\n${err.message}`));
          process.exit(1);
        }
        break;
      }
    }
  }
}

/**
 * Main application loop
 */
async function main() {
  const program = new Command();

  program
    .name('antigravity-mcp-installer')
    .alias('agy-mcp')
    .description('Interactive MCP server installer & manager for Antigravity CLI')
    .version('1.6.0')
    .argument('[query]', 'Search term to install a server (e.g. filesystem, postgres, github)')
    .option('-c, --config <path>', 'Custom path to mcp_config.json')
    .option('-m, --manage', 'Open MCP server management menu directly')
    .option('-l, --list', 'List installed servers directly')
    .option('-a, --audit', 'Audit all installed servers for vulnerabilities')
    .parse(process.argv);

  const options = program.opts();
  const explicitConfigPath = options.config ? path.resolve(options.config) : null;
  let initialArgQuery = program.args[0] || '';

  printBanner();

  if (options.audit) {
    await auditAllInstalledServers();
    return;
  }

  if (options.manage || options.list) {
    await manageExistingServers(explicitConfigPath);
    return;
  }

  if (initialArgQuery) {
    await runSearchAndInstallWizard(initialArgQuery, explicitConfigPath);
    return;
  }

  while (true) {
    const mainActionAns = await promptWithEsc([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          {
            name: `${pc.bold('🔍 Search & Install')} ${pc.dim('(Discover MCP servers on npm and configure)')}`,
            value: 'search'
          },
          {
            name: `${pc.bold('📋 Manage Installed Servers')} ${pc.dim('(Inspect, configure API keys, audit, or remove)')}`,
            value: 'manage'
          },
          {
            name: `${pc.bold('🛡️  Run Security Audit')} ${pc.dim('(Scan all configured servers for CVEs)')}`,
            value: 'audit'
          },
          new inquirer.Separator(),
          {
            name: pc.dim('❌ Exit'),
            value: 'exit'
          }
        ]
      }
    ], true);

    if (mainActionAns === BACK_SIGNAL || mainActionAns.action === 'exit' || !mainActionAns.action) {
      console.log(pc.yellow('Goodbye!\n'));
      process.exit(0);
    }

    if (mainActionAns.action === 'search') {
      await runSearchAndInstallWizard('', explicitConfigPath);
    } else if (mainActionAns.action === 'manage') {
      await manageExistingServers(explicitConfigPath);
    } else if (mainActionAns.action === 'audit') {
      await auditAllInstalledServers();
    }
  }
}

main().catch(err => {
  handleExit();
});
