/**
 * OUTBOX PATTERN — The Dual-Write Problem (Counter-Example)
 * ──────────────────────────────────────────────────────────
 * This test file is intentionally a COUNTER-EXAMPLE.
 * It demonstrates the BUG that the Outbox Pattern solves.
 *
 * The dual-write problem:
 *  When you write to two systems (DB + broker) independently, you have
 *  no atomicity guarantee. The second write can fail after the first succeeds.
 *
 * Scenario A — DB write succeeds, broker write fails:
 *  Order saved. No event published. Email never sent. Inventory not reserved.
 *  The system is now in an inconsistent state.
 *
 * Scenario B — Broker write succeeds, DB write fails:
 *  Event published. Order not saved. Consumers act on a phantom order.
 *  Even worse — now you have ghost actions that can't be traced back to data.
 *
 * These tests document the problem — they don't assert a "correct" outcome.
 * Reading a test that shows the BUG is as educational as reading a test
 * that shows the correct solution. Sometimes the best documentation is
 * a precise description of what can go wrong.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * TIP: Compare this file to 01-atomic-write.test.ts to see the contrast.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { EventBus } from '../../src/shared/EventBus';

// Simulated "naive" order service — no outbox, just two independent writes.
class NaiveOrderService {
  private orders = new Map<string, { id: string; customerId: string; amount: number }>();

  constructor(private readonly bus: EventBus) {}

  async createOrder(
    id: string,
    customerId: string,
    amount: number,
    options: { brokerFails?: boolean; dbFails?: boolean } = {}
  ): Promise<void> {
    // Write 1: save to "database"
    if (!options.dbFails) {
      this.orders.set(id, { id, customerId, amount });
    } else {
      throw new Error('DB write failed');
    }

    // Write 2: publish to "broker" (completely independent)
    if (options.brokerFails) {
      // Broker is down — event never published. But the DB write already committed!
      throw new Error('Broker write failed');
    }

    this.bus.publish('OrderCreated', { orderId: id, customerId, amount });
  }

  getOrder(id: string) {
    return this.orders.get(id);
  }
}

describe('05-outbox / 03-dual-write-problem (counter-example — documents the bug)', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ─── Scenario A: DB write succeeds, broker write fails ────────────────────────

  it('[BUG] order saved but event never published when broker fails after DB write', async () => {
    const eventReceived: unknown[] = [];
    bus.subscribe('OrderCreated', (e) => eventReceived.push(e));

    const naive = new NaiveOrderService(bus);

    // DB write succeeds; broker write fails.
    await expect(
      naive.createOrder('o1', 'cust-1', 100, { brokerFails: true })
    ).rejects.toThrow('Broker write failed');

    // The order IS in the database — it was saved before the broker call.
    expect(naive.getOrder('o1')).toBeDefined();

    // But NO event was published — downstream services are never notified.
    expect(eventReceived).toHaveLength(0);

    // Consequence: the order exists in the DB but the system is inconsistent.
    // No email sent. No inventory reserved. No shipping scheduled.
    // This is the dual-write problem.
  });

  // ─── Scenario B: event published but DB write fails ──────────────────────────

  it('[BUG] event published but order never saved when DB write fails', async () => {
    const eventReceived: unknown[] = [];
    bus.subscribe('OrderCreated', (e) => eventReceived.push(e));

    // To simulate "publish first, then DB": we swap the order in a local wrapper.
    const naiveBus = new EventBus();
    const ghostEvents: unknown[] = [];
    naiveBus.subscribe('OrderCreated', (e) => ghostEvents.push(e));

    const publishThenDb = async () => {
      // Publish to broker first (can't be rolled back once sent).
      naiveBus.publish('OrderCreated', { orderId: 'o2', customerId: 'c2', amount: 999 });

      // Then try to save to DB — but it fails!
      throw new Error('DB write failed');
    };

    await expect(publishThenDb()).rejects.toThrow('DB write failed');

    // Event WAS published — consumers will act on it.
    expect(ghostEvents).toHaveLength(1);

    // Order does NOT exist in the DB — it was never saved.
    // Consumers are now processing an order that doesn't exist in the database.
    // This is arguably worse than Scenario A.
  });

  // ─── The Outbox solution: why it works ───────────────────────────────────────

  it('[CONTRAST] outbox avoids both scenarios by writing atomically', () => {
    // This test just illustrates the mental model — actual tests in 01 and 02.

    // With the outbox:
    //   BEGIN TRANSACTION;
    //     INSERT INTO orders VALUES (...);     -- business data
    //     INSERT INTO outbox VALUES (...);     -- event record
    //   COMMIT;
    //
    // Either BOTH rows exist or NEITHER does.
    // The relay then reads outbox entries and publishes them — independently.
    // If the relay fails, entries stay 'pending' and are retried (at-least-once).
    //
    // Scenario A is impossible: if the DB commit succeeded, the outbox entry exists.
    //   The relay will eventually publish it.
    //
    // Scenario B is impossible: if the DB commit failed, there is no outbox entry.
    //   Nothing will be published.

    // No assertions — this test is documentation.
    expect(true).toBe(true); // The comment above IS the test.
  });

  // ─── Timing matters ───────────────────────────────────────────────────────────

  it('[BUG] a crash between two writes leaves state permanently inconsistent', async () => {
    // Simulate: DB write completes, then process dies (no chance to publish).
    const ordersDb = new Map<string, boolean>();
    const publishedEvents: string[] = [];

    const crashingWriteOperation = async (orderId: string) => {
      ordersDb.set(orderId, true); // DB write
      // Process crashes here — the line below never executes.
      // In production: power failure, OOM kill, network partition, etc.
      /* publishedEvents.push(orderId); */
    };

    await crashingWriteOperation('o-crash');

    // Order is in DB.
    expect(ordersDb.has('o-crash')).toBe(true);

    // Event was never published — and there's no retry mechanism.
    expect(publishedEvents).toHaveLength(0);

    // With the outbox: the outbox entry would exist in the DB too,
    // and the relay would find and publish it on its next poll cycle.
  });
});
