// Read-only integration tests against the deployed TESTNET contract.
// Skipped (not failed) when deployment.json / e2e-results.json are absent,
// e.g. on a fresh clone. They never send transactions.
//
// What they pin down:
//   - the contract named in deployment.json answers views on testnet,
//   - get_owner matches the manifest,
//   - after `node scripts/e2e.mjs` ran, every e2e step passed and the
//     on-chain state agrees with it (1 logged spend of 0.25 NEAR, allowance
//     revoked at the end of the flow).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from '@near-js/providers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(ROOT, 'deployment.json');
const e2ePath = join(ROOT, 'e2e-results.json');
const deployed = existsSync(manifestPath);
const skipReason = deployed ? false : 'deployment.json not present — deploy first (scripts/deploy.mjs)';

const manifest = deployed ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });

async function view(method, args) {
  return provider.callFunction(manifest.contractId, method, args ?? {});
}

test('contract answers get_owner and it matches the manifest', { skip: skipReason }, async () => {
  const owner = await view('get_owner', {});
  assert.equal(owner, manifest.owner);
});

test('vault holds a balance above the contract storage stake', { skip: skipReason }, async () => {
  const balance = BigInt(await view('vault_balance', {}));
  assert.ok(balance > BigInt('5000000000000000000000000'), `vault balance too low: ${balance}`);
});

test('e2e results file reports every policy step passed', { skip: skipReason }, () => {
  assert.ok(existsSync(e2ePath), 'e2e-results.json missing — run scripts/e2e.mjs');
  const results = JSON.parse(readFileSync(e2ePath, 'utf8'));
  assert.ok(results.steps.length >= 7, 'e2e flow should have at least 7 steps');
  for (const s of results.steps) {
    assert.ok(s.ok, `e2e step failed: ${s.name} — ${s.detail ?? ''}`);
  }
});

test('on-chain state agrees with the e2e flow', { skip: skipReason }, async () => {
  const log = await view('get_spend_log', { from_index: 0, limit: 50 });
  assert.ok(Array.isArray(log) && log.length >= 1, 'expected at least one logged spend');
  assert.equal(log[0].to, manifest.payee);
  assert.equal(log[0].amount, '250000000000000000000000'); // 0.25 NEAR in yocto
  const allowance = await view('get_allowance', { agent_id: manifest.agent });
  assert.equal(allowance.revoked, true, 'allowance should be revoked after the e2e flow');
  assert.equal(allowance.spent, '250000000000000000000000');
});
