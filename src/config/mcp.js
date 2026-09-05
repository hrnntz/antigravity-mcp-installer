import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';

/**
 * Safely read or create config file, with auto-recovery for empty or corrupted files
 * @param {string} configPath
 * @returns {Promise<{mcpServers: Record<string, any>}>}
 */
export async function loadOrCreateConfig(configPath) {
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
 * @param {string} configPath
 * @param {object} configData
 */
export async function saveConfig(configPath, configData) {
  const normalizedPath = path.resolve(configPath);
  const tempPath = `${normalizedPath}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;

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
 * Sanitize package name for default server identifier
 * @param {string} pkgName
 * @returns {string}
 */
export function sanitizeServerKey(pkgName) {
  if (!pkgName || typeof pkgName !== 'string') return '';
  return pkgName
    .replace(/^@[^/]+\//, '')
    .replace(/^server-/, '')
    .replace(/-server$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Extract target npm package name from server configuration
 * @param {object} serverConfig
 * @returns {string}
 */
export function getPackageNameFromConfig(serverConfig) {
  if (!serverConfig) return '';
  if (serverConfig.command === 'npx' && Array.isArray(serverConfig.args)) {
    return serverConfig.args.find(a => !a.startsWith('-')) || '';
  }
  return serverConfig.command || '';
}
