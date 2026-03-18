/**
 * OUTBOX PATTERN — Relay Delivery
 * ─────────────────────────────────
 * The Relay is the bridge between the outbox table and the message broker.
 *
 * Relay strategies:
 *  1. Polling: a background job polls for pending entries every N seconds.
 *              Simple, predictable, some latency.
 *  2. CDC (Change Data Capture): listen to the DB transaction log (e.g. Debezium).
 *              Near real-time, more complex infrastructure.
 *
 * This file uses the polling model (simulated by calling relay() manually).
 *
 * Delivery guarantee:
 *  The relay delivers at-least-once. If the relay publishes to the broker
 *  but crashes before marking the entry as 'delivered', the entry stays
 *  'pending' and will be re-published on the next poll cycle.
 *
 * Consumer idempotency:
 *  Because the relay can redeliver, consumers MUST be idempotent.
 *  A common pattern: check if the event id (outboxId) has already been processed
 *  before applying its effects.
 */

import { OutboxStore } from '../../src/05-outbox/OutboxStore';
import { OutboxRelay } from '../../src/05-outbox/OutboxRelay';
import { OrderService } from '../../src/05-outbox/OrderService';
import { EventBus } from '../../src/shared/EventBus';

describe('05-outbox / 02-relay-delivery', () => {
  let outbox: OutboxStore;
  let bus: EventBus;
  let relay: OutboxRelay;
  let orderService: OrderService;

  beforeEach(() => {
    outbox = new OutboxStore();
    bus = new EventBus();
    relay = new OutboxRelay(outbox, bus);
    orderService = new OrderService(outbox);
  });

  // ─── Normal delivery ──────────────────────────────────────────────────────────

  it('relay publishes pending outbox entries to the EventBus', async () => {
    const received: unknown[] = [];
    bus.subscribe('OrderCreated', (event) => received.push(event));

    orderService.createOrder('o1', 'cust-1', 100);
    await relay.relay();

    expect(received).toHaveLength(1);
  });

  it('relay marks entries as delivered after publishing', async () => {
    orderService.createOrder('o1', 'cust-1', 100);
    await relay.relay();

    expect(outbox.getPending()).toHaveLength(0);
    expect(outbox.getAll()[0].status).toBe('delivered');
  });

  it('relay delivers the correct payload to the EventBus subscriber', async () => {
    let deliveredPayload: unknown = null;
    bus.subscribe('OrderCreated', (event) => { deliveredPayload = event; });

    orderService.createOrder('o1', 'cust-1', 250);
    await relay.relay();

    expect(deliveredPayload).toMatchObject({
      aggregateId: 'o1',
      payload: { orderId: 'o1', customerId: 'cust-1', amount: 250 },
    });
  });

  it('relay processes multiple pending entries in one cycle', async () => {
    const received: unknown[] = [];
    bus.subscribe('OrderCreated', (event) => received.push(event));

    orderService.createOrder('o1', 'c1', 100);
    orderService.createOrder('o2', 'c2', 200);
    orderService.createOrder('o3', 'c3', 300);

    await relay.relay();

    expect(received).toHaveLength(3);
    expect(outbox.getPending()).toHaveLength(0);
  });

  // ─── At-least-once on broker failure ─────────────────────────────────────────

  it('on broker failure, entry stays pending and is retried on next cycle', async () => {
    orderService.createOrder('o1', 'cust-1', 100);

    // Simulate transient broker failure.
    relay.simulateBrokerFailure();
    await relay.relay();

    // Entry is still pending — it was not delivered.
    expect(outbox.getPending()).toHaveLength(1);
    expect(outbox.getPending()[0].retries).toBe(1);

    // Next cycle: broker is back — entry is delivered.
    const received: unknown[] = [];
    bus.subscribe('OrderCreated', (e) => received.push(e));
    await relay.relay();

    expect(received).toHaveLength(1);
    expect(outbox.getPending()).toHaveLength(0);
  });

  it('relay stats track delivered and failed counts', async () => {
    orderService.createOrder('o1', 'c1', 100);
    orderService.createOrder('o2', 'c2', 200);

    relay.simulateBrokerFailure(); // first relay cycle: one failure, one success
    await relay.relay();

    const stats = relay.getStats();
    expect(stats.failed).toBe(1);
    expect(stats.delivered).toBe(1);
  });

  // ─── Idempotency via outboxId ─────────────────────────────────────────────────

  it('outboxId can be used as a dedupe key to handle duplicate delivery', async () => {
    const processedIds = new Set<string>();
    let processCount = 0;

    bus.subscribe('OrderCreated', (event) => {
      const { outboxId } = event as { outboxId: string };
      if (processedIds.has(outboxId)) return; // dedupe
      processedIds.add(outboxId);
      processCount++;
    });

    orderService.createOrder('o1', 'c1', 100);

    // Relay once (successful publish + mark delivered).
    await relay.relay();

    // Simulate relay redelivering by manually resetting status.
    outbox.getAll()[0].status = 'pending'; // hack to force redeliver

    // Second relay cycle — same outboxId, same event.
    await relay.relay();

    // Only processed once thanks to dedupe.
    expect(processCount).toBe(1);
  });
});
