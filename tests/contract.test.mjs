// Local artifact tests — no network needed.
//   npm test        (or: node --test tests/)
//
// Verifies the compiled contract artifact exists and exports every public
// method of Agent Allowance Guard, and that the policy guard messages the
// testnet e2e asserts on are present in the contract source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WASM = join(ROOT, 'build', 'contract.wasm');
const SRC = join(ROOT, 'contract', 'src', 'contract.ts');

const EXPECTED_METHODS = [
  'init',
  'create_allowance',
  'spend',
  'revoke',
  'get_owner',
  'get_allowance',
  'get_agent_ids',
  'spend_log_length',
  'get_spend_log',
  'vault_balance',
];

const EXPECTED_GUARDS = [
  'only the owner can create allowances',
  'only the owner can revoke allowances',
  'caller has no allowance',
  'allowance has been revoked',
  'allowance has expired',
  'recipient is not on the allowlist',
  'spending cap exceeded',
  'vault balance is insufficient for this spend',
];

test('build/contract.wasm exists and is a real contract binary', () => {
  assert.ok(existsSync(WASM), 'build/contract.wasm missing — run `npm run build` first');
  const bytes = readFileSync(WASM);
  assert.ok(bytes.length > 100_000, `wasm suspiciously small: ${bytes.length} bytes`);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], 'not a wasm file');
});

test('wasm exports every public contract method', async () => {
  const bytes = readFileSync(WASM);
  const mod = await WebAssembly.compile(bytes);
  const exported = WebAssembly.Module.exports(mod).map((e) => e.name);
  for (const m of EXPECTED_METHODS) {
    assert.ok(exported.includes(m), `method export missing: ${m}`);
  }
});

test('contract source contains every policy guard', () => {
  const src = readFileSync(SRC, 'utf8');
  for (const g of EXPECTED_GUARDS) {
    assert.ok(src.includes(g), `guard missing from contract source: ${g}`);
  }
});

test('contract enforces policy before scheduling the transfer', () => {
  const src = readFileSync(SRC, 'utf8');
  const spendBody = src.slice(src.indexOf('spend({'), src.indexOf('revoke({'));
  const capCheck = spendBody.indexOf('spending cap exceeded');
  const transfer = spendBody.indexOf('promiseBatchActionTransfer');
  assert.ok(capCheck !== -1 && transfer !== -1, 'spend() structure changed');
  assert.ok(capCheck < transfer, 'cap check must come before the transfer is scheduled');
});
