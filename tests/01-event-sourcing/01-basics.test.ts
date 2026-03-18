/**
 * EVENT SOURCING — Basics
 * ───────────────────────
 * Central concept: state is NOT stored directly.
 * Instead, a sequence of immutable EVENTS is stored, and current state is
 * always derived by replaying those events from the beginning.
 *
 * Think of it like a bank statement vs a balance column:
 *  - Traditional approach: store the current balance (mutable row in DB).
 *  - Event Sourcing: store every transaction; balance = sum of all transactions.
 *
 * Benefits:
 *  - Full audit trail — you know every change that ever happened and why.
 *  - Time travel — replay up to any point in time.
 *  - Debugging — reproduce any past state exactly.
 */

import { EventStore } from '../../src/shared/EventStore';
import { BankAccount } from '../../src/01-event-sourcing/BankAccount';

describe('01-event-sourcing / 01-basics', () => {
  let store: EventStore;

  beforeEach(() => {
    // Fresh store per test — no shared mutable state between tests.
    store = new EventStore();
  });

  // ─── Immutable facts ────────────────────────────────────────────────────────

  it('records each action as an immutable event', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);
    account.deposit(50);
    account.withdraw(30);

    // The event store is the source of truth — it has one event per action.
    const events = store.getEvents('acc-1');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual([
      'AccountOpened',
      'MoneyDeposited',
      'MoneyWithdrawn',
    ]);
  });

  it('derives current state from the event log (not from a stored balance)', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 500);
    account.deposit(200);
    account.withdraw(100);

    // State is computed: 500 + 200 - 100 = 600
    expect(account.balance).toBe(600);
    // The underlying store holds events, not balances.
    expect(store.getEvents('acc-1').every((e) => !('balance' in e))).toBe(true);
  });

  it('events are immutable — the log never shrinks or changes', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);

    const snapshot = store.getEvents('acc-1').map((e) => e.type);
    account.deposit(50);

    // The previous event is still there; the log only grows.
    const current = store.getEvents('acc-1').map((e) => e.type);
    expect(current[0]).toBe(snapshot[0]); // AccountOpened still at index 0
    expect(current).toHaveLength(snapshot.length + 1);
  });

  // ─── Business rules enforced before an event is raised ─────────────────────

  it('rejects invalid commands — invalid state never enters the log', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);

    // Insufficient funds — no event should be appended.
    expect(() => account.withdraw(200)).toThrow('Insufficient funds');
    // Log unchanged — the failed command left no trace.
    expect(store.getEvents('acc-1')).toHaveLength(1); // only AccountOpened
  });

  it('prevents opening an already-open account', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);
    expect(() => account.open('Bob', 50)).toThrow('Account is already open');
  });

  it('prevents deposits to a closed account', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);
    account.close();
    expect(() => account.deposit(50)).toThrow('Account is closed');
  });

  // ─── Events carry payload — only what changed, nothing derived ─────────────

  it('event payloads contain the raw fact, not derived state', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);
    account.deposit(75);

    const depositEvent = store.getEvents('acc-1').find((e) => e.type === 'MoneyDeposited')!;
    // Payload is the delta — not the new balance (175).
    expect(depositEvent.payload).toEqual({ amount: 75 });
  });

  // ─── Version / sequence number ──────────────────────────────────────────────

  it('each event has a monotonically increasing version per aggregate', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);
    account.deposit(50);
    account.withdraw(20);

    const versions = store.getEvents('acc-1').map((e) => e.version);
    expect(versions).toEqual([1, 2, 3]);
  });

  it('versions are scoped to each aggregate independently', () => {
    const a1 = new BankAccount('acc-1', store);
    const a2 = new BankAccount('acc-2', store);

    a1.open('Alice', 100);
    a1.deposit(50);
    a2.open('Bob', 200);

    // acc-1 is at version 2, acc-2 is at version 1 — independent counters.
    expect(store.getVersion('acc-1')).toBe(2);
    expect(store.getVersion('acc-2')).toBe(1);
  });
});
