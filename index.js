#!/usr/bin/env node

/**
 * antigravity-mcp-installer
 * Interactive CLI to search, explain, audit risk, configure and manage MCP servers for Antigravity CLI.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import pc from 'picocolors';
import path from 'node:path';
import { BACK_SIGNAL } from './src/constants.js';
import { printBanner, promptWithEsc, handleExit } from './src/ui/prompts.js';
import { manageExistingServers, auditAllInstalledServers } from './src/wizards/manage.js';
import { runSearchAndInstallWizard } from './src/wizards/install.js';

process.on('SIGINT', handleExit);
process.on('SIGTERM', () => process.exit(0));

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

main().catch(() => {
  handleExit();
});
