/**
 * EVENT SOURCING — Replay & Rehydration
 * ──────────────────────────────────────
 * Rehydration: rebuilding an aggregate's in-memory state from its event log.
 * This is how aggregates are loaded — NOT by reading a "current state" row.
 *
 * This is what makes Event Sourcing powerful:
 *  - You can load any aggregate at any point in time.
 *  - You can run the same event log through a different apply() to get a
 *    different view of the same history.
 *  - If you add a new field to the state, you can backfill it by replaying.
 *
 * Optimistic concurrency:
 *  When two processes load the same aggregate and both try to save,
 *  the second writer's expected version won't match → conflict detected.
 */

import { EventStore } from '../../src/shared/EventStore';
import { BankAccount } from '../../src/01-event-sourcing/BankAccount';

describe('01-event-sourcing / 02-replay', () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore();
  });

  // ─── Rehydration ────────────────────────────────────────────────────────────

  it('rehydrates an aggregate to its latest state by replaying all events', () => {
    // First session: commands generate events in the store.
    const original = new BankAccount('acc-1', store);
    original.open('Alice', 500);
    original.deposit(200);
    original.withdraw(100);
    // original.balance === 600

    // Second session: new aggregate instance, same store, same id.
    // No state is passed — only the id and the store.
    const rehydrated = new BankAccount('acc-1', store);
    rehydrated.rehydrate();

    expect(rehydrated.balance).toBe(600);
    expect(rehydrated.owner).toBe('Alice');
    expect(rehydrated.isOpen).toBe(true);
    expect(rehydrated.getVersion()).toBe(3);
  });

  it('can continue operating after rehydration', () => {
    const original = new BankAccount('acc-1', store);
    original.open('Alice', 100);

    const rehydrated = new BankAccount('acc-1', store);
    rehydrated.rehydrate();
    rehydrated.deposit(300);

    expect(rehydrated.balance).toBe(400);
    // The deposit event is now in the shared store.
    expect(store.getEvents('acc-1')).toHaveLength(2);
  });

  it('rehydrates a closed account correctly', () => {
    const original = new BankAccount('acc-1', store);
    original.open('Alice', 100);
    original.close();

    const rehydrated = new BankAccount('acc-1', store);
    rehydrated.rehydrate();

    expect(rehydrated.isOpen).toBe(false);
    expect(() => rehydrated.deposit(10)).toThrow('Account is closed');
  });

  // ─── Time travel ─────────────────────────────────────────────────────────────

  it('can rebuild state at any point in history by selecting events', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100); // v1
    account.deposit(200);       // v2
    account.deposit(300);       // v3
    account.withdraw(50);       // v4

    // Replay only events up to v2 → balance should be 300
    const events = store.getEvents('acc-1').filter((e) => e.version <= 2);
    // We can test this by reading the event payloads manually:
    const balanceAtV2 = events.reduce((bal, e) => {
      if (e.type === 'AccountOpened') return (e.payload as { initialBalance: number }).initialBalance;
      if (e.type === 'MoneyDeposited') return bal + (e.payload as { amount: number }).amount;
      if (e.type === 'MoneyWithdrawn') return bal - (e.payload as { amount: number }).amount;
      return bal;
    }, 0);

    expect(balanceAtV2).toBe(300); // 100 + 200
  });

  // ─── Optimistic concurrency ──────────────────────────────────────────────────

  it('detects concurrent writes via version conflict', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);

    // Session A and Session B both load at version 1.
    // Session A successfully writes (appends at expectedVersion=1).
    store.append({ aggregateId: 'acc-1', type: 'MoneyDeposited', payload: { amount: 50 }, version: 2 }, 1);

    // Session B tries to write — but version 1 was already consumed.
    // The store is now at version 2, so expected=1 fails.
    expect(() =>
      store.append({ aggregateId: 'acc-1', type: 'MoneyDeposited', payload: { amount: 99 }, version: 2 }, 1)
    ).toThrow('Optimistic concurrency conflict');
  });

  it('allows concurrent writes to different aggregates', () => {
    store.append({ aggregateId: 'acc-1', type: 'AccountOpened', payload: {}, version: 1 }, 0);
    store.append({ aggregateId: 'acc-2', type: 'AccountOpened', payload: {}, version: 1 }, 0);

    // No conflict — they are different aggregates.
    expect(store.getVersion('acc-1')).toBe(1);
    expect(store.getVersion('acc-2')).toBe(1);
  });
});
