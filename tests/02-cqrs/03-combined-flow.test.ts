/**
 * CQRS — Combined Flow
 * ─────────────────────
 * Full loop: Command → EventStore → EventBus → Projection → Query
 *
 * This test file demonstrates the complete CQRS pipeline working together.
 * Each component has a single responsibility:
 *
 *  CommandBus   → routes commands to their handler
 *  WriteModel   → validates + appends events to EventStore, then publishes to EventBus
 *  EventStore   → append-only log of domain events (source of truth)
 *  EventBus     → fan-out: notifies all projections synchronously
 *  ReadModel    → maintains query-optimised views (projections)
 *  QueryBus     → routes queries to their handler (reads from ReadModel)
 *
 * Notice that the write side and read side never talk to each other directly —
 * they are decoupled through events. This is the key CQRS insight.
 */

import { EventStore } from '../../src/shared/EventStore';
import { EventBus } from '../../src/shared/EventBus';
import { CommandBus } from '../../src/02-cqrs/CommandBus';
import { QueryBus } from '../../src/02-cqrs/QueryBus';
import { WriteModel } from '../../src/02-cqrs/WriteModel';
import { ReadModel, AccountSummary } from '../../src/02-cqrs/ReadModel';

describe('02-cqrs / 03-combined-flow', () => {
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

  // ─── End-to-end flows ────────────────────────────────────────────────────────

  it('complete lifecycle: open → deposit → withdraw → query', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 1000 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 500 });
    await commandBus.dispatch({ type: 'Withdraw', accountId: 'acc-1', amount: 200 });

    const summary = await queryBus.execute<AccountSummary>({ type: 'GetAccountSummary', accountId: 'acc-1' });

    expect(summary).toMatchObject({
      accountId: 'acc-1',
      owner: 'Alice',
      balance: 1300,
      transactionCount: 2,
    });
  });

  it('multiple accounts are independently tracked', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 100 });
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-2', owner: 'Bob', initialBalance: 200 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 50 });
    await commandBus.dispatch({ type: 'Withdraw', accountId: 'acc-2', amount: 75 });

    const alice = await queryBus.execute<AccountSummary>({ type: 'GetAccountSummary', accountId: 'acc-1' });
    const bob = await queryBus.execute<AccountSummary>({ type: 'GetAccountSummary', accountId: 'acc-2' });

    expect(alice?.balance).toBe(150);
    expect(bob?.balance).toBe(125);
  });

  it('GetAllAccounts returns all projections', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 100 });
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-2', owner: 'Bob', initialBalance: 200 });
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-3', owner: 'Carol', initialBalance: 300 });

    const all = await queryBus.execute<AccountSummary[]>({ type: 'GetAllAccounts' });
    expect(all).toHaveLength(3);
    const owners = all.map((a) => a.owner).sort();
    expect(owners).toEqual(['Alice', 'Bob', 'Carol']);
  });

  // ─── Event store is the source of truth ──────────────────────────────────────

  it('write side and read side agree on the final state', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 500 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 100 });

    // Write side: reconstruct balance from events.
    const events = store.getEvents('acc-1');
    const writeBalance = events.reduce((bal, e) => {
      if (e.type === 'AccountOpened') return (e.payload as { initialBalance: number }).initialBalance;
      if (e.type === 'MoneyDeposited') return bal + (e.payload as { amount: number }).amount;
      return bal;
    }, 0);

    // Read side: query the projection.
    const summary = await queryBus.execute<AccountSummary>({ type: 'GetAccountSummary', accountId: 'acc-1' });

    expect(summary?.balance).toBe(writeBalance);
  });

  // ─── Failed commands leave the read model unchanged ───────────────────────────

  it('a failed command does not corrupt the read model', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 50 });

    const before = await queryBus.execute<AccountSummary>({ type: 'GetAccountSummary', accountId: 'acc-1' });

    try {
      await commandBus.dispatch({ type: 'Withdraw', accountId: 'acc-1', amount: 999 });
    } catch {
      // Expected — insufficient funds.
    }

    const after = await queryBus.execute<AccountSummary>({ type: 'GetAccountSummary', accountId: 'acc-1' });
    expect(after?.balance).toBe(before?.balance);
    expect(after?.transactionCount).toBe(before?.transactionCount);
  });
});
