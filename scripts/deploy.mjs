// Deploy Agent Allowance Guard to NEAR TESTNET.
//
//   node scripts/deploy.mjs
//
// Steps:
//   1. Load the faucet-funded owner account from .near-keys/owner.json
//      (created beforehand with near-cli-rs `sponsor-by-faucet-service`).
//   2. Create subaccounts guard.<owner> (the contract account / vault),
//      agent.<owner> (the AI agent) and payee.<owner> (an allowlisted
//      recipient), each with a locally generated keypair stored only in
//      .near-keys/ (0600).
//   3. Deploy build/contract.wasm to the guard account and call init().
//   4. Write public deployment facts (account ids, tx hashes) to deployment.json.
//
// TESTNET ONLY. No mainnet, no real funds, no secrets are printed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNearAmount } from '@near-js/utils';
import {
  ROOT,
  loadCredential,
  accountFor,
  ensureSubaccount,
  writeManifest,
  EXPLORER_TX,
} from './lib.mjs';

const WASM_PATH = join(ROOT, 'build', 'contract.wasm');
const GAS = BigInt('300000000000000'); // 300 TGas

async function main() {
  const ownerId = loadCredential('owner');
  if (!ownerId) throw new Error('.near-keys/owner.json missing — create the owner account first');
  console.log('owner:  ', ownerId);

  // Subaccount funding (owner starts with 10 testnet NEAR from the faucet):
  //   guard 8.5 N — ~5.46 N is locked as storage stake for the 546 KB wasm,
  //                 the rest is the spendable vault balance.
  //   agent 0.3 N — gas money for the agent's spend() calls.
  //   payee 0.1 N — passive allowlisted recipient.
  const guardId = await ensureSubaccount('owner', 'guard', parseNearAmount('8.5'));
  const agentId = await ensureSubaccount('owner', 'agent', parseNearAmount('0.3'));
  const payeeId = await ensureSubaccount('owner', 'payee', parseNearAmount('0.1'));
  console.log('guard:  ', guardId, '(contract account / vault)');
  console.log('agent:  ', agentId);
  console.log('payee:  ', payeeId);

  const guard = accountFor(guardId);
  const state = await guard.state();
  if (state.code_hash !== '11111111111111111111111111111111') {
    console.log('contract already deployed, skipping deploy + init');
    writeManifest({
      network: 'testnet',
      rpc: 'https://rpc.testnet.near.org',
      owner: ownerId,
      contractId: guardId,
      agent: agentId,
      payee: payeeId,
      note: 'deploy skipped: code already present on the contract account',
    });
    return;
  }

  const code = readFileSync(WASM_PATH);
  console.log(`deploying ${code.length} bytes of wasm...`);
  const deployOutcome = await guard.deployContract(code);
  const deployTx = deployOutcome.transaction.hash;
  console.log('deploy tx:', deployTx, `${EXPLORER_TX}${deployTx}`);

  const initOutcome = await guard.functionCall({
    contractId: guardId,
    methodName: 'init',
    args: { owner: ownerId },
    gas: GAS,
  });
  const initTx = initOutcome.transaction.hash;
  console.log('init tx:  ', initTx, `${EXPLORER_TX}${initTx}`);

  const onChainOwner = await guard.viewFunction({
    contractId: guardId,
    methodName: 'get_owner',
    args: {},
  });
  console.log('on-chain owner:', onChainOwner);
  if (onChainOwner !== ownerId) throw new Error('init owner mismatch');

  writeManifest({
    network: 'testnet',
    rpc: 'https://rpc.testnet.near.org',
    owner: ownerId,
    contractId: guardId,
    agent: agentId,
    payee: payeeId,
    wasmBytes: code.length,
    deployTx,
    initTx,
  });
  console.log('wrote deployment.json');
}

main().catch((err) => {
  console.error('DEPLOY FAILED:', err.message || err);
  process.exit(1);
});
