import { DomainEvent } from '../shared/EventStore';
import { EventBus } from '../shared/EventBus';
import { QueryBus } from './QueryBus';

// ── Projection: Account Summary ───────────────────────────────────────────────

export interface AccountSummary {
  accountId: string;
  owner: string;
  balance: number;
  transactionCount: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export interface GetAccountSummaryQuery {
  readonly type: 'GetAccountSummary';
  readonly accountId: string;
}

export interface GetAllAccountsQuery {
  readonly type: 'GetAllAccounts';
}

/**
 * Read model: one or more projections that listen to events and maintain
 * denormalised, query-optimised views of domain state.
 *
 * Key insights:
 *  - The read model is EVENTUAL — it updates after the write model persists.
 *    In our synchronous EventBus this happens in the same call stack, but in
 *    a real system there would be latency.
 *  - Multiple independent projections can consume the same event stream.
 *  - The read model can be rebuilt at any time by replaying the full event log.
 *  - Queries read from this in-memory store, NOT from the event store.
 */
export class ReadModel {
  private accounts = new Map<string, AccountSummary>();

  subscribeToEvents(bus: EventBus): void {
    bus.subscribe<DomainEvent>('AccountOpened', (event) => {
      const p = event.payload as { owner: string; initialBalance: number };
      this.accounts.set(event.aggregateId, {
        accountId: event.aggregateId,
        owner: p.owner,
        balance: p.initialBalance,
        transactionCount: 0,
      });
    });

    bus.subscribe<DomainEvent>('MoneyDeposited', (event) => {
      const p = event.payload as { amount: number };
      const acc = this.accounts.get(event.aggregateId);
      if (acc) {
        acc.balance += p.amount;
        acc.transactionCount += 1;
      }
    });

    bus.subscribe<DomainEvent>('MoneyWithdrawn', (event) => {
      const p = event.payload as { amount: number };
      const acc = this.accounts.get(event.aggregateId);
      if (acc) {
        acc.balance -= p.amount;
        acc.transactionCount += 1;
      }
    });
  }

  registerQueries(queryBus: QueryBus): void {
    queryBus.register<GetAccountSummaryQuery, AccountSummary | undefined>(
      'GetAccountSummary',
      (q) => this.accounts.get(q.accountId)
    );

    queryBus.register<GetAllAccountsQuery, AccountSummary[]>(
      'GetAllAccounts',
      () => Array.from(this.accounts.values())
    );
  }

  /** Rebuild the projection from a raw event log (e.g. after a deploy). */
  rebuild(events: DomainEvent[]): void {
    this.accounts.clear();
    const bus = new EventBus();
    this.subscribeToEvents(bus);
    for (const event of events) {
      bus.publish(event.type, event);
    }
  }
}
