/**
 * OUTBOX PATTERN — Atomic Write
 * ──────────────────────────────
 * Problem: you need to save data to your database AND publish an event to a
 * message broker. These are two separate systems — you can't wrap them in one
 * ACID transaction. This is the "dual-write problem":
 *
 *   // Two separate writes — what if the second one fails?
 *   await db.save(order);           // ✓ succeeds
 *   await broker.publish(event);    // ✗ crashes → event never sent!
 *
 * Result: the order exists in the DB but no event was published — downstream
 * services never know about it. Data is inconsistent.
 *
 * Solution — Outbox Pattern:
 *   1. Write the business data AND an "outbox entry" to the SAME database
 *      in a SINGLE transaction.
 *   2. A separate relay process reads pending outbox entries and publishes
 *      them to the broker.
 *   3. Once delivered, the entry is marked as 'delivered'.
 *
 * Guarantee:
 *   If the business write succeeds, the outbox entry always exists.
 *   If the business write fails, the outbox entry also doesn't exist.
 *   Either BOTH are written or NEITHER is — atomicity restored.
 *
 * In JavaScript we simulate atomicity with synchronous code (no interleaving).
 * In a real system it would be an explicit DB transaction (BEGIN/COMMIT).
 */

import { OutboxStore } from '../../src/05-outbox/OutboxStore';
import { OrderService } from '../../src/05-outbox/OrderService';

describe('05-outbox / 01-atomic-write', () => {
  let outbox: OutboxStore;
  let orderService: OrderService;

  beforeEach(() => {
    outbox = new OutboxStore();
    orderService = new OrderService(outbox);
  });

  // ─── Atomic write ─────────────────────────────────────────────────────────────

  it('creates an order and an outbox entry in the same "transaction"', () => {
    orderService.createOrder('o1', 'cust-1', 150);

    const order = orderService.getOrder('o1');
    const pending = outbox.getPending();

    // Both exist — atomically.
    expect(order).toBeDefined();
    expect(pending).toHaveLength(1);
    expect(pending[0].aggregateId).toBe('o1');
    expect(pending[0].eventType).toBe('OrderCreated');
  });

  it('outbox entry contains the correct payload', () => {
    orderService.createOrder('o2', 'cust-2', 300);

    const entry = outbox.getPending()[0];
    expect(entry.payload).toEqual({ orderId: 'o2', customerId: 'cust-2', amount: 300 });
  });

  it('outbox entry starts with "pending" status', () => {
    orderService.createOrder('o1', 'cust-1', 50);
    const entry = outbox.getPending()[0];
    expect(entry.status).toBe('pending');
  });

  it('multiple orders produce multiple independent outbox entries', () => {
    orderService.createOrder('o1', 'cust-1', 100);
    orderService.createOrder('o2', 'cust-2', 200);
    orderService.createOrder('o3', 'cust-3', 300);

    expect(outbox.getPending()).toHaveLength(3);
    expect(outbox.getPending().map((e) => e.aggregateId)).toEqual(['o1', 'o2', 'o3']);
  });

  // ─── Outbox guarantees consistency ───────────────────────────────────────────

  it('order and outbox entry always exist together — never one without the other', () => {
    // Simulate 5 order creations and verify invariant after each.
    for (let i = 1; i <= 5; i++) {
      orderService.createOrder(`o${i}`, `cust-${i}`, i * 100);

      const allOrders = orderService.getAllOrders();
      const allEntries = outbox.getAll();

      // Invariant: #orders always equals #outbox entries.
      expect(allOrders.length).toBe(allEntries.length);
    }
  });

  it('outbox entry ids are unique', () => {
    orderService.createOrder('o1', 'c1', 10);
    orderService.createOrder('o2', 'c2', 20);
    orderService.createOrder('o3', 'c3', 30);

    const ids = outbox.getAll().map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  // ─── Delivery state transitions ───────────────────────────────────────────────

  it('marking an entry as delivered removes it from pending', () => {
    orderService.createOrder('o1', 'c1', 100);
    const entry = outbox.getPending()[0];

    outbox.markDelivered(entry.id);

    expect(outbox.getPending()).toHaveLength(0);
    const delivered = outbox.getAll().find((e) => e.id === entry.id);
    expect(delivered?.status).toBe('delivered');
    expect(delivered?.deliveredAt).toBeDefined();
  });
});
