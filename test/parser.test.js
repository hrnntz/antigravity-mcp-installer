import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRequiredEnvVars, extractCapabilities } from '../src/parser/readme.js';

test('detectRequiredEnvVars: extracts typical API keys and tokens', () => {
  const readme = `
  # MCP Server
  Requires BRAVE_API_KEY or GITHUB_PERSONAL_ACCESS_TOKEN to connect.
  Database connection: DATABASE_URL.
  `;
  const vars = detectRequiredEnvVars(readme);
  assert.ok(vars.includes('BRAVE_API_KEY'));
  assert.ok(vars.includes('GITHUB_PERSONAL_ACCESS_TOKEN'));
  assert.ok(vars.includes('DATABASE_URL'));
});

test('detectRequiredEnvVars: ignores generic placeholder names', () => {
  const readme = `
  Set your API_KEY or YOUR_API_KEY or ACCESS_TOKEN here.
  Valid: STRIPE_SECRET_KEY.
  `;
  const vars = detectRequiredEnvVars(readme);
  assert.ok(vars.includes('STRIPE_SECRET_KEY'));
  assert.ok(!vars.includes('API_KEY'));
  assert.ok(!vars.includes('YOUR_API_KEY'));
  assert.ok(!vars.includes('ACCESS_TOKEN'));
});

test('detectRequiredEnvVars: extracts from JSON env config blocks', () => {
  const readme = `
  \`\`\`json
  {
    "env": {
      "CUSTOM_PROVIDER_API_KEY": "xxxx",
      "SERVICE_AUTH_TOKEN": "yyyy"
    }
  }
  \`\`\`
  `;
  const vars = detectRequiredEnvVars(readme);
  assert.ok(vars.includes('CUSTOM_PROVIDER_API_KEY'));
  assert.ok(vars.includes('SERVICE_AUTH_TOKEN'));
});

test('detectRequiredEnvVars: handles empty or invalid inputs gracefully', () => {
  assert.deepEqual(detectRequiredEnvVars(''), []);
  assert.deepEqual(detectRequiredEnvVars(null), []);
  assert.deepEqual(detectRequiredEnvVars(undefined), []);
});

test('extractCapabilities: extracts bullet points under tools/features section', () => {
  const readme = `
  # Documentation

  ## Features & Tools
  - **search**: Full text document search
  - \`read_file\`: Read local file content
  * execute_query: Query Postgres database

  ## Configuration
  Do not extract this section.
  - ignored bullet point
  `;
  const caps = extractCapabilities(readme);
  assert.equal(caps.length, 3);
  assert.equal(caps[0], 'search: Full text document search');
  assert.equal(caps[1], 'read_file: Read local file content');
  assert.equal(caps[2], 'execute_query: Query Postgres database');
});

test('extractCapabilities: handles empty or invalid inputs', () => {
  assert.deepEqual(extractCapabilities(''), []);
  assert.deepEqual(extractCapabilities(null), []);
});
