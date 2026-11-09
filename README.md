# Agent Allowance Guard

**Give an AI agent money without giving it the keys to everything.**

Agent Allowance Guard is a NEAR **testnet** smart contract that acts as a
policy engine and sandboxed allowance vault for AI agents. A human owner
creates a bounded *allowance* for an agent — a spending cap, an expiry, and a
recipient allowlist. The agent can then pull funds from the contract **only**
inside that policy. Every spend is checked on-chain before any transfer is
scheduled, appended to an on-chain audit log, and emitted as a NEP-297 event.
The owner can revoke the allowance instantly.

Built at **NEAR HACKATHON** ("Build Beyond Boundaries", 2026-11-01 →
2026-11-14). Tracks: **`security`** (primary) and **`agents`**.

- Contract (live on testnet): `guard.aag7734b.testnet`
- Explorer: https://explorer.testnet.near.org/accounts/guard.aag7734b.testnet
- Demo page: [`demo.html`](demo.html) — open it in any browser, no build step
- Deployment evidence: [`DEPLOYMENT.md`](DEPLOYMENT.md)

## The problem

AI agents increasingly need to *spend*: pay for APIs, data, compute, or other
agents. The usual options are both bad:

- **Give the agent a wallet key** — one prompt injection or bug away from a
  drained wallet. The key can do anything, forever, to anyone.
- **Approve every transaction by hand** — defeats the point of an agent.

What agents actually need is what a good corporate card gives an employee:
a *bounded, revocable, auditable* spending mandate. That is what this
contract implements, enforced by the chain rather than by trusting the
agent's code.

## What it does

The owner (a human account) calls `create_allowance` with:

| Policy field | Meaning |
| --- | --- |
| `agent_id` | The only account allowed to spend under this allowance |
| `cap` | Lifetime spending cap, in yoctoNEAR (decimal string) |
| `expires_at` | Nanosecond Unix timestamp after which spends are rejected |
| `allowlist` | The only accounts that may receive funds |

The agent then calls `spend(to, amount)`. The contract enforces, **in order,
before any transfer exists**:

1. the caller has an allowance (caller = the agent, via `predecessorAccountId`),
2. the allowance is not revoked,
3. the allowance has not expired (block timestamp < `expires_at`),
4. `to` is on the allowlist,
5. `amount` is positive and `spent + amount ≤ cap`,
6. the vault (the contract account's own balance) can cover the spend.

If any check fails, the call panics with a specific message
(`"spending cap exceeded"`, `"recipient is not on the allowlist"`,
`"allowance has been revoked"`, `"allowance has expired"`, …) and no funds
move. If all checks pass, the spend is recorded in an append-only on-chain
log, a NEP-297 `EVENT_JSON` line is emitted, and only then is the transfer
scheduled as a promise batch action.

The owner can call `revoke(agent_id)` at any time; revocation takes effect
immediately and permanently for that allowance.

Views: `get_allowance` (policy + spent + remaining), `get_spend_log`
(the audit trail), `get_agent_ids`, `vault_balance`, `get_owner`.

## Try it — do X, see Y

**Option A — just look (30 seconds).**
Open [`demo.html`](demo.html) in a browser.
→ You see the live policy for `agent.aag7734b.testnet` read straight from
NEAR testnet RPC: cap 1 NEAR, spent 0.25 NEAR, remaining 0.75 NEAR, status
REVOKED (the recorded end state of the verified flow below), and the audit
log with the single 0.25 NEAR spend to `payee.aag7734b.testnet`.
If the RPC is unreachable the page clearly labels the fallback sample data.

**Option B — verify the recorded flow on-chain (2 minutes).**

```sh
# the one allowed spend: agent -> payee, exactly +0.25 NEAR
https://explorer.testnet.near.org/transactions/9hhaiv48Q6nESBuURHDQ1KofVfnnsjtwWszhx7ASvNhm

# read the audit log yourself
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":"1","method":"query",
  "params":{"request_type":"call_function","finality":"final",
    "account_id":"guard.aag7734b.testnet","method_name":"get_spend_log",
    "args_base64":"eyJmcm9tX2luZGV4IjowLCJsaW1pdCI6NTB9"}}'
```
→ The log contains exactly one entry: 0.25 NEAR to the allowlisted payee.
The over-cap and non-allowlisted attempts in the same flow panicked and left
no trace in the log — that absence is the point. Full step-by-step results
with every tx hash: [`DEPLOYMENT.md`](DEPLOYMENT.md) and
[`e2e-results.json`](e2e-results.json).

**Option C — run the tests (5 minutes).**

```sh
npm install --ignore-scripts && npm test
```
→ 8 tests: 4 artifact tests (wasm exists, exports all 10 public methods,
policy guards present in source, checks ordered before the transfer) and 4
read-only live-testnet integration tests (owner matches the manifest, vault
balance, e2e results all-passed, on-chain state agrees). The live tests skip
cleanly if `deployment.json` is absent.

**Option D — re-run the whole flow yourself.**
`node scripts/deploy.mjs` then `node scripts/e2e.mjs` (needs a faucet-funded
testnet owner key in `.near-keys/owner.json`; see `scripts/deploy.mjs`
header). The e2e creates a fresh allowance and asserts: allowed spend
succeeds and pays exactly 0.25 NEAR → over-cap spend fails → non-allowlisted
spend fails → log holds exactly 1 entry → revoke → post-revoke spend fails.

## How NEAR is used, concretely

- **The contract account *is* the vault.** The contract holds funds as its
  own account balance; there is no separate token and no custodian. Fund it
  by transferring NEAR to the contract account.
- **Predecessor-based caller identity.** NEAR function calls carry an
  authenticated predecessor account id, so "the caller is the agent named in
  the allowance" is enforced by the protocol, not by signatures the agent
  could share or leak.
- **Policy before promises.** All checks run in the contract call itself;
  the transfer is only scheduled afterwards via
  `promiseBatchCreate` + `promiseBatchActionTransfer`. A failed check means
  the transfer promise is never created.
- **On-chain auditability.** Spends are stored in an append-only `Vector`
  log *and* emitted as NEP-297 `EVENT_JSON` logs, so indexers and the owner
  can reconstruct exactly what the agent did, forever.
- **Subaccounts as roles.** Owner, contract, agent and payee are NEAR
  subaccounts (`guard.` / `agent.` / `payee.aag7734b.testnet`), which makes
  the demo reproducible and the roles unambiguous on the explorer.
- **Instant revocation.** Revocation is a state flag checked on every
  spend — the on-chain equivalent of cancelling a card, with no key
  rotation and no cooperation needed from the agent.

This is the security track's brief taken literally — *spending limits,
policy engines, sandboxed wallets* — and the agents track's spending half
with the safety half attached: the same contract is what an agent-commerce
agent would spend through.

## Contract API

Amounts are yoctoNEAR decimal strings (the standard JSON encoding for NEAR
u128 values; near-sdk-js v2 delivers JSON args untyped, so the contract
converts explicitly with `BigInt()`).

| Method | Type | Args | Notes |
| --- | --- | --- | --- |
| `init` | init | `{ owner? }` | Defaults to the caller |
| `create_allowance` | call, payable | `{ agent_id, cap, expires_at, allowlist }` | Owner only. Attached deposit funds the vault |
| `spend` | call | `{ to, amount }` | Caller must be the allowance's agent |
| `revoke` | call | `{ agent_id }` | Owner only, immediate |
| `get_owner` | view | `{}` | |
| `get_allowance` | view | `{ agent_id }` | Policy + spent + remaining, or `null` |
| `get_agent_ids` | view | `{ from_index?, limit? }` | |
| `spend_log_length` | view | `{}` | |
| `get_spend_log` | view | `{ from_index?, limit? }` | Append-only audit log |
| `vault_balance` | view | `{}` | Contract account balance (incl. storage stake) |

## Repository layout

```
contract/src/contract.ts   the contract (NEAR SDK JS, TypeScript)
scripts/lib.mjs            key loading (@near-js v2), helpers — keys stay in .near-keys/
scripts/deploy.mjs         create role subaccounts, deploy wasm, init
scripts/e2e.mjs            the asserted end-to-end policy flow on testnet
tests/contract.test.mjs    artifact + source tests (offline)
tests/testnet.test.mjs     read-only live integration tests (skip if undeployed)
demo.html                  single-file live demo page (RPC reads, sample fallback)
deployment.json            public deployment facts (accounts, tx hashes)
e2e-results.json           recorded e2e outcome
DEPLOYMENT.md              deployment + flow evidence, account balances
SUBMISSION.md              human-only submission checklist + draft demo post
```

## Build

```sh
npm install --ignore-scripts
# near-sdk-js downloads its compiler toolchain (binaryen/QuickJS/wasi-sdk)
# in a postinstall step. On most machines plain `npm install` just works.
# In sandboxed environments where install scripts cannot use the network:
TAR_OPTIONS=--no-same-owner node node_modules/near-sdk-js/lib/cli/post-install.js

npm run build   # -> build/contract.wasm
```

Toolchain: Node 20+, `near-sdk-js` 2.0.0, `@near-js/*` 2.5.x,
TypeScript 5.x (TypeScript 6 currently breaks the SDK's typecheck step).

## Honest limitations

- Testnet only. This is a hackathon prototype, not an audited product.
- One allowance per agent; re-creating an allowance is only possible after
  the previous one is revoked or expired.
- The vault balance includes the contract's storage stake (~5.5 NEAR for
  the 546 KB JS-SDK wasm), so `vault_balance` overstates spendable funds by
  that locked amount; per-spend balance checks plus the cap keep spends safe
  regardless.
- The owner is a single account (no multisig). A production version would
  add a multisig owner, per-spend and daily sub-limits, and a
  function-call-key-based agent session so the agent never holds a
  full-access key at all.

## Baseline disclosure

Every line of code in this repository — contract, scripts, tests, demo page
and docs — was written **during the NEAR HACKATHON window** (2026-11-09),
AI-assisted (written by an AI coding agent working for the team, per the
hackathon's own HACKATHON.md workflow). No pre-existing project code is
included. Libraries used, all listed in `package.json`: `near-sdk-js`
(contract SDK + compiler), `@near-js/accounts`, `@near-js/crypto`,
`@near-js/keystores`, `@near-js/providers`, `@near-js/signers`,
`@near-js/utils` (deploy/e2e/tests). `near-cli-rs` was used once to create
the faucet-funded testnet owner account. The testnet accounts and keys were
generated fresh for this project; keys live only in `.near-keys/`
(gitignored, mode 0600) and are never committed.

## License

MIT — see [`LICENSE`](LICENSE).
