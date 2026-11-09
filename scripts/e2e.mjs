// End-to-end policy flow against the deployed TESTNET contract.
//
//   node scripts/e2e.mjs
//
// Flow (each step is asserted; the script exits non-zero on any failure):
//   1. owner creates an allowance for the agent: cap 1 NEAR, expires in 1h,
//      allowlist = [payee]
//   2. agent spends 0.25 NEAR to payee            -> must SUCCEED, payee paid
//   3. agent spends 0.80 NEAR to payee            -> must FAIL (cap exceeded)
//   4. agent spends 0.01 NEAR to a non-allowlisted account -> must FAIL
//   5. spend log on-chain has exactly 1 entry (the 0.25 NEAR spend)
//   6. owner revokes the allowance
//   7. agent spends 0.01 NEAR to payee            -> must FAIL (revoked)
// Tx hashes for every step are written to e2e-results.json.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNearAmount, formatNearAmount } from '@near-js/utils';
import {
  ROOT,
  loadCredential,
  accountFor,
  readManifest,
  expectCallFailure,
} from './lib.mjs';

const GAS = BigInt('300000000000000'); // 300 TGas for owner calls
const SPEND_GAS = BigInt('30000000000000'); // 30 TGas is ample for spend()
const results = { steps: [] };
let failures = 0;

function step(name, ok, detail, tx) {
  results.steps.push({ name, ok, detail, tx: tx ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}${tx ? ` (tx ${tx})` : ''}`);
  if (!ok) failures++;
}

async function main() {
  for (const label of ['owner', 'guard', 'agent', 'payee']) loadCredential(label);
  const m = readManifest();
  const { owner: ownerId, contractId, agent: agentId, payee: payeeId } = m;
  if (!contractId) throw new Error('deployment.json missing — run scripts/deploy.mjs first');

  const owner = accountFor(ownerId);
  const agent = accountFor(agentId);
  const guard = accountFor(contractId);

  // Keep the agent funded for gas (a function call pre-pays worst-case gas).
  const agentBalance = BigInt((await agent.getAccountBalance()).total);
  if (agentBalance < BigInt(parseNearAmount('0.5'))) {
    await owner.sendMoney(agentId, BigInt(parseNearAmount('0.3')));
    console.log('note: topped up the agent account with 0.3 NEAR for gas');
  }

  const view = (methodName, args) =>
    guard.viewFunction({ contractId, methodName, args });

  // 0. Clean slate check: no active allowance yet (first run) — if one exists
  //    and is active from a previous partial run, revoke it so the flow is
  //    deterministic.
  const prior = await view('get_allowance', { agent_id: agentId });
  if (prior && !prior.revoked) {
    await owner.functionCall({
      contractId, methodName: 'revoke', args: { agent_id: agentId }, gas: GAS,
    });
    console.log('note: revoked a leftover active allowance from a previous run');
  }

  // 1. Create allowance.
  const cap = parseNearAmount('1');
  const expiresAt = (BigInt(Date.now()) * 1_000_000n + 3_600_000_000_000n).toString(); // +1h, ns
  const createOutcome = await owner.functionCall({
    contractId,
    methodName: 'create_allowance',
    args: { agent_id: agentId, cap, expires_at: expiresAt, allowlist: [payeeId] },
    gas: GAS,
  });
  step('create_allowance (cap 1 NEAR, allowlist=[payee])', true, '', createOutcome.transaction.hash);

  const created = await view('get_allowance', { agent_id: agentId });
  step(
    'get_allowance shows cap 1 NEAR, spent 0',
    created && created.cap === cap && created.spent === '0' && created.revoked === false,
    created ? `cap=${formatNearAmount(created.cap)} NEAR remaining=${formatNearAmount(created.remaining)} NEAR` : 'null',
  );

  // 2. Allowed spend: 0.25 NEAR agent -> payee.
  const payeeBefore = BigInt((await accountFor(payeeId).getAccountBalance()).total);
  const spendOutcome = await agent.functionCall({
    contractId,
    methodName: 'spend',
    args: { to: payeeId, amount: parseNearAmount('0.25') },
    gas: SPEND_GAS,
  });
  const payeeAfter = BigInt((await accountFor(payeeId).getAccountBalance()).total);
  step(
    'spend 0.25 NEAR to allowlisted payee succeeds',
    payeeAfter - payeeBefore === BigInt(parseNearAmount('0.25')),
    `payee balance +${formatNearAmount((payeeAfter - payeeBefore).toString())} NEAR`,
    spendOutcome.transaction.hash,
  );

  // 3. Over-cap spend: 0.80 NEAR (only 0.75 NEAR of cap remains).
  const overCapText = await expectCallFailure(
    () =>
      agent.functionCall({
        contractId,
        methodName: 'spend',
        args: { to: payeeId, amount: parseNearAmount('0.8') },
        gas: SPEND_GAS,
      }),
    'over-cap spend',
  );
  step(
    'spend 0.80 NEAR fails: spending cap exceeded',
    overCapText.includes('spending cap exceeded'),
    overCapText.slice(0, 160),
  );

  // 4. Non-allowlisted recipient.
  const notAllowedText = await expectCallFailure(
    () =>
      agent.functionCall({
        contractId,
        methodName: 'spend',
        args: { to: ownerId, amount: parseNearAmount('0.01') },
        gas: SPEND_GAS,
      }),
    'non-allowlisted spend',
  );
  step(
    'spend to non-allowlisted account fails',
    notAllowedText.includes('not on the allowlist'),
    notAllowedText.slice(0, 160),
  );

  // 5. Audit log.
  const log = await view('get_spend_log', { from_index: 0, limit: 50 });
  step(
    'on-chain spend log has exactly the 1 allowed spend',
    Array.isArray(log) && log.length === 1 && log[0].to === payeeId && log[0].amount === parseNearAmount('0.25'),
    log && log.length ? `entries=${log.length}, amount=${formatNearAmount(log[0].amount)} NEAR` : 'empty',
  );

  // 6. Revoke.
  const revokeOutcome = await owner.functionCall({
    contractId, methodName: 'revoke', args: { agent_id: agentId }, gas: GAS,
  });
  const afterRevoke = await view('get_allowance', { agent_id: agentId });
  step('owner revoke() takes effect instantly', afterRevoke.revoked === true, '', revokeOutcome.transaction.hash);

  // 7. Spend after revoke.
  const revokedText = await expectCallFailure(
    () =>
      agent.functionCall({
        contractId,
        methodName: 'spend',
        args: { to: payeeId, amount: parseNearAmount('0.01') },
        gas: SPEND_GAS,
      }),
    'post-revoke spend',
  );
  step(
    'spend after revoke fails',
    revokedText.includes('revoked'),
    revokedText.slice(0, 160),
  );

  const vault = await view('vault_balance', {});
  results.vaultBalanceNear = formatNearAmount(vault);
  console.log(`vault balance: ${results.vaultBalanceNear} NEAR (includes storage stake)`);

  writeFileSync(join(ROOT, 'e2e-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n${failures === 0 ? 'ALL STEPS PASSED' : `${failures} STEP(S) FAILED`} — details in e2e-results.json`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('E2E FAILED:', err.message || err);
  process.exit(1);
});
