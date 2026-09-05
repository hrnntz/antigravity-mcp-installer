import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadOrCreateConfig,
  saveConfig,
  sanitizeServerKey,
  getPackageNameFromConfig
} from '../src/config/mcp.js';

test('sanitizeServerKey: removes scoped prefix and server affixes', () => {
  assert.equal(sanitizeServerKey('@modelcontextprotocol/server-filesystem'), 'filesystem');
  assert.equal(sanitizeServerKey('@modelcontextprotocol/server-brave-search'), 'brave-search');
  assert.equal(sanitizeServerKey('postgres-server'), 'postgres');
  assert.equal(sanitizeServerKey('server-sqlite'), 'sqlite');
  assert.equal(sanitizeServerKey('my.custom!mcp'), 'my-custom-mcp');
  assert.equal(sanitizeServerKey(''), '');
});

test('getPackageNameFromConfig: extracts package name correctly', () => {
  const npxServer = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory']
  };
  assert.equal(getPackageNameFromConfig(npxServer), '@modelcontextprotocol/server-memory');

  const customServer = {
    command: 'my-custom-binary',
    args: ['--port', '8080']
  };
  assert.equal(getPackageNameFromConfig(customServer), 'my-custom-binary');

  assert.equal(getPackageNameFromConfig(null), '');
});

test('loadOrCreateConfig & saveConfig: roundtrip and corruption recovery', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-mcp-test-'));
  const testConfigPath = path.join(tmpDir, 'test_config.json');

  try {
    // 1. Initial file creation when not exists
    const initial = await loadOrCreateConfig(testConfigPath);
    assert.deepEqual(initial, { mcpServers: {} });

    // 2. Save new server
    initial.mcpServers['my-server'] = {
      command: 'npx',
      args: ['-y', 'my-pkg'],
      env: { KEY: 'val' }
    };
    await saveConfig(testConfigPath, initial);

    // 3. Reload saved config
    const reloaded = await loadOrCreateConfig(testConfigPath);
    assert.deepEqual(reloaded.mcpServers['my-server'], {
      command: 'npx',
      args: ['-y', 'my-pkg'],
      env: { KEY: 'val' }
    });

    // 4. Empty file auto-recovery
    await fs.writeFile(testConfigPath, '   \n  ', 'utf-8');
    const fromEmpty = await loadOrCreateConfig(testConfigPath);
    assert.deepEqual(fromEmpty, { mcpServers: {} });

    // 5. Corrupted JSON auto-recovery with backup
    await fs.writeFile(testConfigPath, '{ bad-json: true ', 'utf-8');
    const fromCorrupted = await loadOrCreateConfig(testConfigPath);
    assert.deepEqual(fromCorrupted, { mcpServers: {} });

    const filesInDir = await fs.readdir(tmpDir);
    const backupFile = filesInDir.find(f => f.includes('corrupted'));
    assert.ok(backupFile, 'Backup file should have been created on corrupted JSON');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
