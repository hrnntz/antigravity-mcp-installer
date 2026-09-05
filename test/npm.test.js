import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuickRisk, computeRank } from '../src/api/npm.js';

test('evaluateQuickRisk: official packages are always LOW risk', () => {
  const official = {
    name: '@modelcontextprotocol/server-filesystem',
    downloadsWeekly: 5,
    hasRepo: false
  };
  assert.equal(evaluateQuickRisk(official).level, 'LOW');
});

test('evaluateQuickRisk: low downloads and no repo triggers HIGH risk', () => {
  const sketchy = {
    name: 'sketchy-unknown-mcp',
    downloadsWeekly: 10,
    hasRepo: false
  };
  assert.equal(evaluateQuickRisk(sketchy).level, 'HIGH');
});

test('evaluateQuickRisk: moderate downloads or with repo triggers MEDIUM risk', () => {
  const moderate = {
    name: 'some-community-mcp',
    downloadsWeekly: 50,
    hasRepo: true
  };
  assert.equal(evaluateQuickRisk(moderate).level, 'MEDIUM');
});

test('computeRank: prioritizes name match with mcp over generic description match', () => {
  const exact = {
    package: { name: 'postgres-mcp-server', description: '', keywords: [] },
    downloads: { weekly: 100 }
  };
  const generic = {
    package: { name: 'knip', description: 'supports postgres mcp', keywords: [] },
    downloads: { weekly: 50000 }
  };

  const exactScore = computeRank(exact, 'postgres');
  const genericScore = computeRank(generic, 'postgres');

  assert.ok(exactScore > genericScore, 'Exact name + mcp must outrank generic package with high downloads');
});
