import inquirer from 'inquirer';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { BACK_SIGNAL } from '../constants.js';

/**
 * Handle Ctrl+C (SIGINT) cleanly
 */
export function handleExit() {
  console.log(pc.yellow('\n\nOperation cancelled by user.'));
  process.exit(0);
}

/**
 * Print terminal banner
 */
export function printBanner() {
  console.log();
  console.log(pc.bold(pc.cyan('antigravity-mcp-installer')) + pc.dim(' (agy-mcp)'));
  console.log(pc.dim('Search, audit, configure & manage MCP servers for Antigravity CLI'));
  console.log(pc.dim('Tip: Press [Esc] to go back, or [Ctrl+C] to exit.'));
  console.log();
}

/**
 * Safe process execution without shell invocation
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export function runCommand(command, args = []) {
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
 * @param {any} questionOrQuestions
 * @param {boolean} allowEsc
 * @returns {Promise<any>}
 */
export async function promptWithEsc(questionOrQuestions, allowEsc = true) {
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
