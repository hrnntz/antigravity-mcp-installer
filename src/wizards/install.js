import inquirer from 'inquirer';
import ora from 'ora';
import pc from 'picocolors';
import { GLOBAL_CONFIG_PATH, LOCAL_CONFIG_PATH, FORBIDDEN_SERVER_KEYS, BACK_SIGNAL } from '../constants.js';
import { loadOrCreateConfig, saveConfig, sanitizeServerKey } from '../config/mcp.js';
import { queryOsvVulnerabilities } from '../api/osv.js';
import { searchNpmMcpServers, evaluateQuickRisk } from '../api/npm.js';
import { extractCapabilities, detectRequiredEnvVars } from '../parser/readme.js';
import { promptWithEsc, runCommand } from '../ui/prompts.js';

/**
 * Fetch package explanation, audit security, and detect required environment variables in parallel
 * @param {object} pkg
 */
export async function fetchExplanationAndSecurity(pkg) {
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
 * Search and Install Wizard
 * @param {string} initialQuery
 * @param {string|null} explicitConfigPath
 */
export async function runSearchAndInstallWizard(initialQuery = '', explicitConfigPath = null) {
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
