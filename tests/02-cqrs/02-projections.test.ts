/**
 * CQRS — Projections (Read Models)
 * ─────────────────────────────────
 * A projection is a view of the event stream, optimised for a specific query.
 *
 * Analogy: think of a SQL VIEW, but built from events instead of joined tables.
 *
 * Properties of projections:
 *  - DERIVED: they are built entirely from events — never from primary data.
 *  - EVENTUAL: they update after the write side — briefly inconsistent is OK.
 *  - REBUILDABLE: destroy the projection and replay events to regenerate it.
 *  - MULTIPLE: the same event stream can feed many independent projections.
 *
 * "Eventual consistency" in this synchronous example means "updated in the
 * same call stack" — but in a real distributed system, there's a delay.
 * Design your UI and consumers to tolerate that delay.
 */

import { EventStore } from '../../src/shared/EventStore';
import { EventBus } from '../../src/shared/EventBus';
import { CommandBus } from '../../src/02-cqrs/CommandBus';
import { QueryBus } from '../../src/02-cqrs/QueryBus';
import { WriteModel } from '../../src/02-cqrs/WriteModel';
import { ReadModel } from '../../src/02-cqrs/ReadModel';

describe('02-cqrs / 02-projections', () => {
  let store: EventStore;
  let bus: EventBus;
  let commandBus: CommandBus;
  let queryBus: QueryBus;
  let writeModel: WriteModel;
  let readModel: ReadModel;

  beforeEach(() => {
    store = new EventStore();
    bus = new EventBus();
    commandBus = new CommandBus();
    queryBus = new QueryBus();
    writeModel = new WriteModel(store, bus);
    readModel = new ReadModel();

    writeModel.registerHandlers(commandBus);
    readModel.subscribeToEvents(bus);
    readModel.registerQueries(queryBus);
  });

  // ─── Projection state ────────────────────────────────────────────────────────

  it('projection reflects the latest state after each command', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 100 });
    const afterOpen = await queryBus.execute<{ balance: number }>({ type: 'GetAccountSummary', accountId: 'acc-1' });
    expect(afterOpen?.balance).toBe(100);

    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 50 });
    const afterDeposit = await queryBus.execute<{ balance: number }>({ type: 'GetAccountSummary', accountId: 'acc-1' });
    expect(afterDeposit?.balance).toBe(150);
  });

  it('tracks transaction count independently of balance', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 1000 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 100 });
    await commandBus.dispatch({ type: 'Withdraw', accountId: 'acc-1', amount: 50 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 25 });

    const summary = await queryBus.execute<{ transactionCount: number }>({
      type: 'GetAccountSummary',
      accountId: 'acc-1',
    });
    // Open doesn't count as a transaction; 3 subsequent operations do.
    expect(summary?.transactionCount).toBe(3);
  });

  // ─── Multiple projections from one stream ────────────────────────────────────

  it('a second projection can be built from the same event bus', async () => {
    // Build a second read model that only counts total accounts.
    let totalAccounts = 0;
    bus.subscribe('AccountOpened', () => { totalAccounts += 1; });

    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 100 });
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-2', owner: 'Bob', initialBalance: 200 });

    // Standard read model still works...
    const accounts = await queryBus.execute<{ accountId: string }[]>({ type: 'GetAllAccounts' });
    expect(accounts).toHaveLength(2);

    // ...and our second projection also received the events.
    expect(totalAccounts).toBe(2);
  });

  // ─── Rebuild from event log ───────────────────────────────────────────────────

  it('projection can be rebuilt from scratch by replaying the event log', async () => {
    // Populate some events.
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 500 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 100 });
    await commandBus.dispatch({ type: 'Withdraw', accountId: 'acc-1', amount: 50 });

    // Simulate a "projection restart" — new instance, no subscriptions yet.
    const freshReadModel = new ReadModel();
    freshReadModel.rebuild(store.getAllEvents());
    const freshQueryBus = new QueryBus();
    freshReadModel.registerQueries(freshQueryBus);

    const summary = await freshQueryBus.execute<{ balance: number; owner: string }>({
      type: 'GetAccountSummary',
      accountId: 'acc-1',
    });

    expect(summary?.balance).toBe(550); // 500 + 100 - 50
    expect(summary?.owner).toBe('Alice');
  });

  it('rebuilt projection matches live projection exactly', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 100 });
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-2', owner: 'Bob', initialBalance: 200 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 50 });

    const liveAccounts = await queryBus.execute<{ accountId: string; balance: number }[]>({
      type: 'GetAllAccounts',
    });

    const freshReadModel = new ReadModel();
    freshReadModel.rebuild(store.getAllEvents());
    const freshQueryBus = new QueryBus();
    freshReadModel.registerQueries(freshQueryBus);

    const rebuiltAccounts = await freshQueryBus.execute<{ accountId: string; balance: number }[]>({
      type: 'GetAllAccounts',
    });

    // Sort both by accountId for deterministic comparison.
    const sort = (arr: { accountId: string }[]) => arr.sort((a, b) => a.accountId.localeCompare(b.accountId));
    expect(sort(rebuiltAccounts)).toEqual(sort(liveAccounts));
  });
});
