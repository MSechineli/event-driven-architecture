/**
 * EVENT SOURCING — Snapshots
 * ──────────────────────────
 * Problem: an aggregate with 10,000 events takes 10,000 apply() calls to load.
 *
 * Solution: periodically capture a "snapshot" — a serialised copy of the
 * current state at a given version. On load, start from the snapshot and only
 * replay events AFTER it.
 *
 * Key rule: A snapshot is a performance optimisation ONLY.
 *  - The event log remains the authoritative source of truth.
 *  - You can always delete all snapshots and rebuild from events alone.
 *  - Never discard events just because you have a snapshot.
 *
 * When to snapshot:
 *  - After N events (e.g. every 100).
 *  - On a schedule (e.g. nightly).
 *  - After a major state change that would be expensive to re-derive.
 */

import { EventStore } from '../../src/shared/EventStore';
import { BankAccount } from '../../src/01-event-sourcing/BankAccount';

describe('01-event-sourcing / 03-snapshots', () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore();
  });

  // ─── Taking a snapshot ───────────────────────────────────────────────────────

  it('captures current state and version in a snapshot', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 500);
    account.deposit(200);
    account.withdraw(50);

    const snapshot = account.takeSnapshot();

    expect(snapshot.aggregateId).toBe('acc-1');
    expect(snapshot.version).toBe(3);
    expect((snapshot.state as { balance: number; owner: string; isOpen: boolean }).balance).toBe(650);
    expect((snapshot.state as { balance: number; owner: string; isOpen: boolean }).owner).toBe('Alice');
    expect((snapshot.state as { balance: number; owner: string; isOpen: boolean }).isOpen).toBe(true);
  });

  // ─── Rehydrating from a snapshot ─────────────────────────────────────────────

  it('rehydrates from snapshot + only the subsequent events', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 500); // v1
    account.deposit(200);        // v2
    account.deposit(100);        // v3

    // Snapshot taken at v3.
    const snapshot = account.takeSnapshot();
    expect(snapshot.version).toBe(3);

    // More events after the snapshot.
    account.withdraw(50);  // v4
    account.deposit(25);   // v5

    // New instance: rehydrate from snapshot (v3) + events v4 and v5.
    const restored = new BankAccount('acc-1', store);
    restored.rehydrate(snapshot);

    expect(restored.balance).toBe(775);  // 500+200+100 - 50 + 25
    expect(restored.getVersion()).toBe(5);
  });

  it('produces the same result as full replay without a snapshot', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);
    account.deposit(50);
    account.withdraw(30);
    account.deposit(200);

    const snapshot = account.takeSnapshot();
    account.withdraw(20);
    account.deposit(10);

    // Rehydrate with snapshot
    const withSnapshot = new BankAccount('acc-1', store);
    withSnapshot.rehydrate(snapshot);

    // Rehydrate without snapshot (full replay)
    const withFullReplay = new BankAccount('acc-1', store);
    withFullReplay.rehydrate();

    expect(withSnapshot.balance).toBe(withFullReplay.balance);
    expect(withSnapshot.getVersion()).toBe(withFullReplay.getVersion());
  });

  // ─── Snapshots don't replace the log ─────────────────────────────────────────

  it('event log still contains all events even after a snapshot', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 100);
    account.deposit(50);
    account.deposit(25);

    account.takeSnapshot(); // snapshot captured — but log is untouched

    // All 3 events are still in the store.
    expect(store.getEvents('acc-1')).toHaveLength(3);
  });

  // ─── Performance intuition ────────────────────────────────────────────────────

  it('demonstrates the performance benefit: fewer events to replay', () => {
    const account = new BankAccount('acc-1', store);
    account.open('Alice', 0);

    // Simulate an account with many transactions.
    for (let i = 0; i < 50; i++) {
      account.deposit(10);
    }
    // 51 events total (1 open + 50 deposits)

    const snapshot = account.takeSnapshot();

    // 10 more events after snapshot
    for (let i = 0; i < 10; i++) {
      account.withdraw(5);
    }

    const eventsAfterSnapshot = store
      .getEvents('acc-1')
      .filter((e) => e.version > snapshot.version);

    // Without snapshot: would replay 61 events.
    // With snapshot: replay only 10 events.
    expect(eventsAfterSnapshot).toHaveLength(10);
    expect(store.getEvents('acc-1')).toHaveLength(61);
  });
});
