import test from 'node:test';
import assert from 'node:assert/strict';
import { queryOsvVulnerabilities } from '../src/api/osv.js';

test('queryOsvVulnerabilities: handles null or non-string inputs', async () => {
  const r1 = await queryOsvVulnerabilities(null);
  assert.deepEqual(r1, { vulns: [], activeVulns: [] });

  const r2 = await queryOsvVulnerabilities('');
  assert.deepEqual(r2, { vulns: [], activeVulns: [] });
});

test('queryOsvVulnerabilities: queries OSV API for a safe package without errors', async () => {
  const result = await queryOsvVulnerabilities('@modelcontextprotocol/server-filesystem');
  assert.ok(Array.isArray(result.vulns));
  assert.ok(Array.isArray(result.activeVulns));
});
