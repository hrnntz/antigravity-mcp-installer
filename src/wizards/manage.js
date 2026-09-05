import inquirer from 'inquirer';
import ora from 'ora';
import pc from 'picocolors';
import path from 'node:path';
import { GLOBAL_CONFIG_PATH, LOCAL_CONFIG_PATH, BACK_SIGNAL } from '../constants.js';
import { loadOrCreateConfig, saveConfig, getPackageNameFromConfig } from '../config/mcp.js';
import { queryOsvVulnerabilities } from '../api/osv.js';
import { promptWithEsc } from '../ui/prompts.js';

/**
 * Manage existing MCP servers module with full Esc back navigation
 * @param {string|null} explicitPath
 */
export async function manageExistingServers(explicitPath = null) {
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
export async function auditAllInstalledServers() {
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
