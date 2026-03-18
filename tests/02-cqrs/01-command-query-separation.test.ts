/**
 * CQRS — Command/Query Separation
 * ────────────────────────────────
 * CQRS = Command Query Responsibility Segregation.
 *
 * The fundamental rule (from CQS, Bertrand Meyer, 1988):
 *   A function should either CHANGE state OR RETURN data — never both.
 *
 * In CQRS this is elevated to an architectural pattern:
 *   COMMANDS → write side (changes state, returns nothing meaningful)
 *   QUERIES  → read side  (returns data, never changes state)
 *
 * Why separate them?
 *  - Commands and queries have very different scaling needs.
 *  - The read model can be optimised for queries (denormalised, indexed, cached).
 *  - The write model can be optimised for consistency and business rules.
 *  - You can scale them independently (e.g. 10 read replicas, 1 write primary).
 */

import { EventStore } from '../../src/shared/EventStore';
import { EventBus } from '../../src/shared/EventBus';
import { CommandBus } from '../../src/02-cqrs/CommandBus';
import { QueryBus } from '../../src/02-cqrs/QueryBus';
import { WriteModel } from '../../src/02-cqrs/WriteModel';
import { ReadModel } from '../../src/02-cqrs/ReadModel';

describe('02-cqrs / 01-command-query-separation', () => {
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

  // ─── Commands express intent ────────────────────────────────────────────────

  it('a command expresses intent to change state — it returns nothing', async () => {
    const result = await commandBus.dispatch({
      type: 'OpenAccount',
      accountId: 'acc-1',
      owner: 'Alice',
      initialBalance: 100,
    });

    // Commands return void — they signal intent, not outcome data.
    expect(result).toBeUndefined();
  });

  it('commands change state via the write model', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 500 });
    await commandBus.dispatch({ type: 'Deposit', accountId: 'acc-1', amount: 200 });

    // Verify by querying (not by inspecting command return value).
    const summary = await queryBus.execute<{ balance: number }>({ type: 'GetAccountSummary', accountId: 'acc-1' });
    expect(summary?.balance).toBe(700);
  });

  it('commands enforce business rules and throw on violation', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 50 });

    await expect(
      commandBus.dispatch({ type: 'Withdraw', accountId: 'acc-1', amount: 100 })
    ).rejects.toThrow('Insufficient funds');
  });

  it('throws when dispatching an unregistered command type', async () => {
    await expect(
      commandBus.dispatch({ type: 'DeleteAccount', accountId: 'acc-1' } as never)
    ).rejects.toThrow('No handler registered');
  });

  // ─── Queries read state — they never mutate it ─────────────────────────────

  it('a query returns data without changing any state', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 100 });

    const before = store.getEvents('acc-1').length;
    await queryBus.execute({ type: 'GetAccountSummary', accountId: 'acc-1' });
    const after = store.getEvents('acc-1').length;

    // No new events were written by the query.
    expect(after).toBe(before);
  });

  it('queries can be called multiple times with the same result (idempotent reads)', async () => {
    await commandBus.dispatch({ type: 'OpenAccount', accountId: 'acc-1', owner: 'Alice', initialBalance: 250 });

    const r1 = await queryBus.execute<{ balance: number }>({ type: 'GetAccountSummary', accountId: 'acc-1' });
    const r2 = await queryBus.execute<{ balance: number }>({ type: 'GetAccountSummary', accountId: 'acc-1' });

    expect(r1?.balance).toBe(r2?.balance);
  });

  it('returns undefined for unknown aggregates — not an error', async () => {
    const result = await queryBus.execute({ type: 'GetAccountSummary', accountId: 'nonexistent' });
    expect(result).toBeUndefined();
  });

  it('throws when executing an unregistered query type', async () => {
    await expect(
      queryBus.execute({ type: 'GetTransactionHistory', accountId: 'acc-1' } as never)
    ).rejects.toThrow('No handler registered');
  });
});
