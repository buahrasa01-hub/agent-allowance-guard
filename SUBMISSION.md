# Submission checklist — HUMAN steps only

Per the hackathon rules (https://nearhackathon.com/HACKATHON.md), three
things must be done by the human, in this order, **before
2026-11-14T23:59:00Z**. Everything else (code, testnet deployment, tests,
demo page) is already done in this repository.

## 1. Make the repository public and push it — ✅ DONE 2026-11-09 (https://github.com/buahrasa01-hub/agent-allowance-guard, public, pushed as buahrasa01-hub)

GitHub CLI is not logged in on the build machine, so this push needs the
human's GitHub login:

```sh
gh auth login
gh repo create agent-allowance-guard --public --source=. --remote=origin --push
```

(Or create an empty public repo on github.com and `git push` this repo to
it.) The repository must stay public through judging (until ~2026-11-25).

## 2. Publish the demo post on X — ✅ DONE 2026-11-09 (https://x.com/buahrasa1/status/2119748288861893001 — verified: repo link, @NEARProtocol, #NEARHackathon, demo screenshot attached)

The post must say the project was built at NEAR HACKATHON, tag
**@NEARProtocol** and **#NEARHackathon**, and attach a demo video or
screenshots (record `demo.html` showing the live policy + audit log, or
screenshot it, plus optionally the explorer page of the spend tx
`9hhaiv48Q6nESBuURHDQ1KofVfnnsjtwWszhx7ASvNhm`).

Draft text (edit freely, keep the tags):

> An AI agent with a wallet key can spend everything. I built Agent
> Allowance Guard at NEAR HACKATHON instead: a NEAR testnet contract that
> gives an agent a bounded allowance — spending cap, expiry, recipient
> allowlist — enforced on-chain, with every spend in an audit log and
> instant owner revoke.
>
> Live demo: the agent spent 0.25 NEAR to an allowlisted payee; its
> over-cap and non-allowlisted spends were rejected on-chain.
> Repo: <REPO URL>
>
> @NEARProtocol #NEARHackathon

Save the post URL — it goes into the submission as `demoUrl`.

## 3. Submit ONCE via the API (human confirms the exact payload first)

Collect these values from the human — never guess them:

- `leadName` — team lead's real name
- `email` — contact email (max 2 submissions per email)
- `size` — one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`
- `nearAddress` — the team's **mainnet** NEAR account for the prize payout
  (create it in any NEAR wallet; the agent must never invent one)
- consent to: "I agree that the organizers may use these details to review
  our submission and contact us about this hackathon."

Fixed values for this project:

- `projectName`: `Agent Allowance Guard`
- `tracks`: `["security", "agents"]`
- `projectUrl`: the public repo URL from step 1
- `demoUrl`: the X post URL from step 2
- `idea` (draft, 20–2000 chars):
  "AI agents need to spend money, but handing an agent a wallet key means
  one bug or prompt injection can drain everything, while approving every
  transaction by hand defeats the purpose of an agent. Agent Allowance
  Guard is a NEAR testnet smart contract that works like a bounded
  corporate card for agents: the owner creates an allowance with a
  spending cap, an expiry and a recipient allowlist. The agent can only
  pull funds inside that policy — every spend is checked on-chain before
  any transfer is scheduled, written to an append-only audit log and
  emitted as a NEP-297 event — and the owner can revoke instantly. NEAR
  makes this natural: predecessor-based caller identity authenticates the
  agent, the contract account itself is the vault, and subaccounts model
  owner/agent/payee roles. Verified live on testnet: an allowed 0.25 NEAR
  spend succeeded; over-cap and non-allowlisted spends were rejected
  on-chain."

Then generate `requestId` once (`uuidgen` or
`node -e 'console.log(crypto.randomUUID())'`), print the full JSON payload,
get the human's explicit yes, and only then:

```sh
curl -sS -X POST https://nearhackathon.com/api/applications \
  -H 'Content-Type: application/json' \
  -d '<THE CONFIRMED PAYLOAD>'
```

Rules: 201 = saved. **Never submit the same repository twice** (409);
mistakes are fixed via https://nearhackathon.com/request-changes. Do NOT
add a `website` field — it is a spam trap that rejects the submission.
Keep the `requestId`: retries after a network error must reuse it.
