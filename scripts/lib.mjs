// Shared helpers for the deploy / e2e scripts.
// TESTNET ONLY. Keys live in ../.near-keys/ (gitignored, mode 0600) and are
// never printed. Only account ids and tx hashes are logged.
//
// Uses the @near-js v2 API: one KeyPairSigner per account, and
// new Account(accountId, provider, signer).

import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { JsonRpcProvider } from '@near-js/providers';
import { Account } from '@near-js/accounts';

export const NETWORK_ID = 'testnet';
export const RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
export const EXPLORER_TX = 'https://explorer.testnet.near.org/transactions/';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const KEYS_DIR = join(ROOT, '.near-keys');
export const MANIFEST_PATH = join(ROOT, 'deployment.json');

export const provider = new JsonRpcProvider({ url: RPC_URL });

// label -> { accountId, keyPair }
const registry = new Map();
// accountId -> keyPair
const byAccountId = new Map();

function credPath(label) {
  return join(KEYS_DIR, `${label}.json`);
}

function register(label, accountId, keyPair) {
  registry.set(label, { accountId, keyPair });
  byAccountId.set(accountId, keyPair);
}

/** Load an existing credential file. Returns account id or null. */
export function loadCredential(label) {
  if (registry.has(label)) return registry.get(label).accountId;
  const path = credPath(label);
  if (!existsSync(path)) return null;
  const cred = JSON.parse(readFileSync(path, 'utf8'));
  register(label, cred.account_id, KeyPair.fromString(cred.private_key));
  return cred.account_id;
}

export function accountFor(accountId) {
  const keyPair = byAccountId.get(accountId);
  if (!keyPair) {
    // View-only account (no signing). Signing calls will fail loudly, which is
    // what we want if a key is missing.
    return new Account(accountId, provider, null);
  }
  return new Account(accountId, provider, KeyPairSigner.fromSecretKey(keyPair.toString()));
}

/**
 * Ensure a subaccount `label.ownerId` exists with a locally generated keypair.
 * The keypair is generated here, used to create the account, and stored ONLY
 * in .near-keys/<label>.json (0600). Returns the subaccount id.
 */
export async function ensureSubaccount(ownerLabel, label, initialNearYocto) {
  const existing = loadCredential(label);
  if (existing) return existing;

  const ownerId = loadCredential(ownerLabel);
  if (!ownerId) throw new Error(`owner credential '${ownerLabel}' not found in .near-keys/`);
  const subId = `${label}.${ownerId}`;
  const keyPair = KeyPair.fromRandom('ed25519');
  register(label, subId, keyPair);

  const owner = accountFor(ownerId);
  await owner.createAccount(subId, keyPair.getPublicKey(), BigInt(initialNearYocto));

  const cred = {
    account_id: subId,
    public_key: keyPair.getPublicKey().toString(),
    private_key: keyPair.toString(),
  };
  writeFileSync(credPath(label), JSON.stringify(cred, null, 2));
  chmodSync(credPath(label), 0o600);
  return subId;
}

export function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return {};
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

export function writeManifest(data) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(data, null, 2) + '\n');
}

/** Extract readable text from a failed function-call outcome or thrown error. */
export function failureText(errOrOutcome) {
  if (!errOrOutcome) return '';
  if (typeof errOrOutcome === 'string') return errOrOutcome;
  const parts = [];
  if (errOrOutcome.message) parts.push(errOrOutcome.message);
  try {
    parts.push(JSON.stringify(errOrOutcome));
  } catch {
    /* ignore */
  }
  return parts.join(' ');
}

/**
 * Run a function call that is EXPECTED to fail on-chain (contract panic).
 * Returns the failure text so the caller can assert on the panic message.
 * Throws if the call unexpectedly succeeds.
 */
export async function expectCallFailure(fn, label) {
  try {
    const outcome = await fn();
    const status = outcome?.status ?? outcome?.transaction_outcome?.outcome?.status;
    if (status && typeof status === 'object' && 'Failure' in status) {
      return JSON.stringify(status.Failure);
    }
    const receipts = outcome?.receipts_outcome ?? [];
    for (const r of receipts) {
      const s = r?.outcome?.status;
      if (s && typeof s === 'object' && 'Failure' in s) return JSON.stringify(s.Failure);
    }
    throw new Error(`${label}: expected the call to fail, but it succeeded`);
  } catch (err) {
    if (err.message && err.message.startsWith(`${label}: expected`)) throw err;
    return failureText(err);
  }
}
