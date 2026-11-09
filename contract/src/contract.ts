// Agent Allowance Guard — a policy engine / sandboxed allowance vault for AI agents.
//
// Written for NEAR HACKATHON ("Build Beyond Boundaries"), tracks: security, agents.
// All code in this repository was written during the hackathon window
// (2026-11-01 .. 2026-11-14), AI-assisted. See README.md.
//
// Idea: an owner (a human) gives an AI agent a *bounded* allowance instead of
// wallet keys. The agent can only pull funds from this contract when ALL of
// the following hold:
//   - the caller is the agent named in the allowance,
//   - the allowance has not been revoked,
//   - the current block time is before the allowance expiry,
//   - the recipient is on the allowance's allowlist,
//   - spent + amount stays within the spending cap,
//   - the contract actually holds enough balance.
// Every successful spend is appended to an on-chain audit log and emitted as a
// NEP-297 EVENT_JSON log line. The owner can revoke an allowance instantly;
// after revocation no further spend is possible.

import {
  NearBindgen,
  near,
  call,
  view,
  initialize,
  assert,
  UnorderedMap,
  Vector,
} from 'near-sdk-js';

/** One agent's allowance policy. Amounts are yoctoNEAR (1 NEAR = 10^24). */
class Allowance {
  agent: string;
  cap: bigint;
  spent: bigint;
  // Nanosecond Unix timestamp (u64) after which spends are rejected.
  expires_at: bigint;
  allowlist: string[];
  revoked: boolean;

  constructor({
    agent,
    cap,
    expires_at,
    allowlist,
  }: {
    agent: string;
    cap: bigint;
    expires_at: bigint;
    allowlist: string[];
  }) {
    this.agent = agent;
    this.cap = cap;
    this.spent = BigInt(0);
    this.expires_at = expires_at;
    this.allowlist = allowlist;
    this.revoked = false;
  }
}

/** One entry of the append-only on-chain audit log. Amounts are yoctoNEAR strings. */
class SpendRecord {
  agent: string;
  to: string;
  amount: string;
  block_timestamp: string;

  constructor({
    agent,
    to,
    amount,
    block_timestamp,
  }: {
    agent: string;
    to: string;
    amount: string;
    block_timestamp: string;
  }) {
    this.agent = agent;
    this.to = to;
    this.amount = amount;
    this.block_timestamp = block_timestamp;
  }
}

const ACCOUNT_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function assertValidAccountId(accountId: string): void {
  assert(
    typeof accountId === 'string' &&
      accountId.length >= 2 &&
      accountId.length <= 64 &&
      ACCOUNT_ID_RE.test(accountId),
    `invalid account id: ${accountId}`,
  );
}

/** Parse a decimal-string integer argument into a BigInt, with a clean panic. */
function toBigInt(value: string, field: string): bigint {
  assert(
    typeof value === 'string' && /^[0-9]+$/.test(value),
    `${field} must be a decimal integer string`,
  );
  return BigInt(value);
}

function emitEvent(event: string, data: Record<string, unknown>): void {
  near.log(
    'EVENT_JSON:' +
      JSON.stringify({
        standard: 'agent-allowance-guard',
        version: '1.0.0',
        event,
        data: [data],
      }),
  );
}

@NearBindgen({ requireInit: true })
export class AgentAllowanceGuard {
  owner: string = '';
  allowances: UnorderedMap<Allowance> = new UnorderedMap('a');
  spend_log: Vector<SpendRecord> = new Vector('s');

  @initialize({ privateFunction: true })
  init({ owner }: { owner?: string }) {
    const initialOwner = owner ?? near.predecessorAccountId();
    assertValidAccountId(initialOwner);
    this.owner = initialOwner;
  }

  // ------------------------------------------------------------------ writes

  /**
   * Create (or replace a revoked/expired) allowance for `agent_id`.
   * Owner-only. Payable: any attached deposit funds the vault.
   * `cap` is the lifetime spending cap in yoctoNEAR (decimal string, the
   * standard JSON encoding for NEAR u128 values).
   * `expires_at` is a nanosecond Unix timestamp (decimal string).
   * Note: near-sdk-js v2 delivers JSON args untyped, so integer inputs are
   * accepted as strings and converted with BigInt() explicitly.
   */
  @call({ payableFunction: true })
  create_allowance({
    agent_id,
    cap,
    expires_at,
    allowlist,
  }: {
    agent_id: string;
    cap: string;
    expires_at: string;
    allowlist: string[];
  }) {
    assert(
      near.predecessorAccountId() === this.owner,
      'only the owner can create allowances',
    );
    assertValidAccountId(agent_id);
    const capBn = toBigInt(cap, 'cap');
    const expiresAtBn = toBigInt(expires_at, 'expires_at');
    assert(capBn > BigInt(0), 'cap must be positive');
    assert(
      expiresAtBn > near.blockTimestamp(),
      'expiry must be in the future',
    );
    assert(
      Array.isArray(allowlist) && allowlist.length > 0,
      'allowlist must not be empty',
    );
    for (const entry of allowlist) {
      assertValidAccountId(entry);
    }

    const existing = this.allowances.get(agent_id);
    assert(
      existing === null || existing.revoked || existing.expires_at <= near.blockTimestamp(),
      'an active allowance already exists for this agent; revoke it first',
    );

    this.allowances.set(
      agent_id,
      new Allowance({
        agent: agent_id,
        cap: capBn,
        expires_at: expiresAtBn,
        allowlist,
      }),
    );

    emitEvent('allowance_created', {
      agent: agent_id,
      cap: capBn.toString(),
      expires_at: expiresAtBn.toString(),
      allowlist,
    });
  }

  /**
   * Pull `amount` yoctoNEAR from the vault to `to`.
   * Caller must be the agent named in an allowance; every policy rule is
   * enforced on-chain before any transfer is scheduled.
   */
  @call({})
  spend({ to, amount }: { to: string; amount: string }) {
    const amountBn = toBigInt(amount, 'amount');
    const agent = near.predecessorAccountId();
    const allowance = this.allowances.get(agent);
    assert(allowance !== null, 'caller has no allowance');
    assert(!allowance.revoked, 'allowance has been revoked');
    assert(
      near.blockTimestamp() < allowance.expires_at,
      'allowance has expired',
    );
    assertValidAccountId(to);
    assert(
      allowance.allowlist.includes(to),
      'recipient is not on the allowlist',
    );
    assert(amountBn > BigInt(0), 'amount must be positive');
    assert(
      allowance.spent + amountBn <= allowance.cap,
      'spending cap exceeded',
    );
    assert(
      near.accountBalance() >= amountBn,
      'vault balance is insufficient for this spend',
    );

    allowance.spent = allowance.spent + amountBn;
    this.allowances.set(agent, allowance);

    this.spend_log.push(
      new SpendRecord({
        agent,
        to,
        amount: amountBn.toString(),
        block_timestamp: near.blockTimestamp().toString(),
      }),
    );

    emitEvent('spend', {
      agent,
      to,
      amount: amountBn.toString(),
      spent_total: allowance.spent.toString(),
      cap: allowance.cap.toString(),
    });

    const promise = near.promiseBatchCreate(to);
    near.promiseBatchActionTransfer(promise, amountBn);
    return undefined;
  }

  /** Revoke an agent's allowance instantly. Owner-only. */
  @call({})
  revoke({ agent_id }: { agent_id: string }) {
    assert(
      near.predecessorAccountId() === this.owner,
      'only the owner can revoke allowances',
    );
    const allowance = this.allowances.get(agent_id);
    assert(allowance !== null, 'no allowance exists for this agent');
    allowance.revoked = true;
    this.allowances.set(agent_id, allowance);
    emitEvent('allowance_revoked', { agent: agent_id });
  }

  // ------------------------------------------------------------------- views

  @view({})
  get_owner(): string {
    return this.owner;
  }

  @view({})
  get_allowance({ agent_id }: { agent_id: string }) {
    const allowance = this.allowances.get(agent_id);
    if (allowance === null) {
      return null;
    }
    return {
      agent: allowance.agent,
      cap: allowance.cap.toString(),
      spent: allowance.spent.toString(),
      remaining: (allowance.cap - allowance.spent).toString(),
      expires_at: allowance.expires_at.toString(),
      allowlist: allowance.allowlist,
      revoked: allowance.revoked,
    };
  }

  @view({})
  get_agent_ids({
    from_index,
    limit,
  }: {
    from_index?: number;
    limit?: number;
  }): string[] {
    return this.allowances.keys({
      start: from_index ?? 0,
      limit: limit ?? 100,
    });
  }

  @view({})
  spend_log_length(): number {
    return this.spend_log.length;
  }

  @view({})
  get_spend_log({
    from_index,
    limit,
  }: {
    from_index?: number;
    limit?: number;
  }): SpendRecord[] {
    const start = from_index ?? 0;
    const count = limit ?? 50;
    const end = Math.min(this.spend_log.length, start + count);
    const result: SpendRecord[] = [];
    for (let i = start; i < end; i++) {
      result.push(this.spend_log.get(i));
    }
    return result;
  }

  /** Current vault balance (the contract account's balance), yoctoNEAR string. */
  @view({})
  vault_balance(): string {
    return near.accountBalance().toString();
  }
}
