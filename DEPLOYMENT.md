# Deployment record — NEAR testnet

All activity is on **NEAR testnet** with free faucet funds. No mainnet, no
real funds. Keys for every account below were generated locally for this
project and live only in `.near-keys/` (gitignored, mode 0600); they are
never printed or committed.

## Accounts

| Role | Account | How it was created |
| --- | --- | --- |
| Owner (human role) | `aag7734b.testnet` | near-cli-rs `create-account sponsor-by-faucet-service` (free, 10 NEAR) — creation tx `AXqnfoGRcBPWRAhNyPqF8fLCbheMuXGSYo3yuLXpFm96` |
| Contract / vault | `guard.aag7734b.testnet` | Subaccount created by `scripts/deploy.mjs`, funded with 8.5 NEAR |
| Agent | `agent.aag7734b.testnet` | Subaccount, funded with 0.3 NEAR (+0.3 top-up during e2e) |
| Payee (allowlisted recipient) | `payee.aag7734b.testnet` | Subaccount, funded with 0.1 NEAR |

## Contract deployment

- Wasm: `build/contract.wasm`, 546,317 bytes (near-sdk-js 2.0.0 build of
  `contract/src/contract.ts`)
- Deploy tx: [`HPeKnZP1Qh3BgmmaHNrB9qJzkemheSBJdhT8zXkuBVF6`](https://explorer.testnet.near.org/transactions/HPeKnZP1Qh3BgmmaHNrB9qJzkemheSBJdhT8zXkuBVF6)
- Init tx (`init { owner: aag7734b.testnet }`): [`Fm2MjW7jBhZGSDbHkJGL3zsAXZRRkXxmJGZ7zEY1cEa4`](https://explorer.testnet.near.org/transactions/Fm2MjW7jBhZGSDbHkJGL3zsAXZRRkXxmJGZ7zEY1cEa4)
- `get_owner` read back on-chain after init: `aag7734b.testnet` ✓

Note: an earlier deployment of a pre-fix build (deploy tx
`3FRtyeuEDD7vLmSZHWEanUJTMFc9SUWjNpKFNsewNDRz`) was deleted on purpose —
account-deletion tx `EsySxsabVa3PKRYRhZmGvDrBpoLwKYYv2hpknv6RF83F` returned
its funds to the owner — after a serialization bug was found (near-sdk-js
v2 passes u128 args as strings; the contract now converts explicitly). The
account was then recreated and the fixed contract deployed as above. The
bug and fix are also documented in the contract source comments.

## Verified end-to-end flow (`node scripts/e2e.mjs`, all steps PASS)

Allowance under test: agent `agent.aag7734b.testnet`, cap **1 NEAR**,
allowlist **[`payee.aag7734b.testnet`]**, expiry +1 hour.

| # | Step | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `create_allowance` by owner | ✓ success | tx [`YyZuQA1mV3suWQb7D6hNHgg1jXGyz6MczkKFCxX8Y5k`](https://explorer.testnet.near.org/transactions/YyZuQA1mV3suWQb7D6hNHgg1jXGyz6MczkKFCxX8Y5k) |
| 2 | `get_allowance` | ✓ cap 1 NEAR, spent 0, remaining 1 NEAR | view call |
| 3 | agent `spend` 0.25 NEAR → payee | ✓ success, payee balance **+0.25 NEAR exactly** | tx [`9hhaiv48Q6nESBuURHDQ1KofVfnnsjtwWszhx7ASvNhm`](https://explorer.testnet.near.org/transactions/9hhaiv48Q6nESBuURHDQ1KofVfnnsjtwWszhx7ASvNhm) |
| 4 | agent `spend` 0.80 NEAR → payee | ✓ rejected on-chain: `Smart contract panicked: assertion failed: spending cap exceeded` | failure recorded in `e2e-results.json` |
| 5 | agent `spend` 0.01 NEAR → owner (not allowlisted) | ✓ rejected on-chain: `recipient is not on the allowlist` | `e2e-results.json` |
| 6 | `get_spend_log` | ✓ exactly 1 entry (the 0.25 NEAR spend) | view call |
| 7 | owner `revoke` | ✓ success, `revoked = true` read back | tx [`EgCmj9cv52QrE49KnXiL5LkiDZyjpZJjdyKCB1p49CGz`](https://explorer.testnet.near.org/transactions/EgCmj9cv52QrE49KnXiL5LkiDZyjpZJjdyKCB1p49CGz) |
| 8 | agent `spend` 0.01 NEAR → payee after revoke | ✓ rejected on-chain: `allowance has been revoked` | `e2e-results.json` |

Final vault balance after the flow: **8.245 NEAR** (includes the ~5.46 NEAR
storage stake for the wasm). Full machine-readable record:
[`e2e-results.json`](e2e-results.json). Test suite (`npm test`): 8/8 pass,
including live read-only integration tests that re-check the state above.

## Reproduce

```sh
npm install --ignore-scripts
TAR_OPTIONS=--no-same-owner node node_modules/near-sdk-js/lib/cli/post-install.js  # only if install scripts had no network
npm run build
# place a faucet-funded testnet owner credential at .near-keys/owner.json
# ({account_id, public_key, private_key}), then:
node scripts/deploy.mjs
node scripts/e2e.mjs
```
