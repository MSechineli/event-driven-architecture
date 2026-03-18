/**
 * SAGA PATTERN — Compensation
 * ────────────────────────────
 * When a saga step fails, all previously completed steps must be "undone"
 * using compensating transactions.
 *
 * A compensating transaction is NOT a rollback — the original transaction
 * already committed. Instead, it's a new transaction that semantically reverses it.
 *
 * Examples:
 *  - ChargePayment committed → compensate with RefundPayment
 *  - ReserveInventory committed → compensate with ReleaseInventory
 *  - ScheduleShipping committed → compensate with CancelShipping
 *
 * CRITICAL: Compensation order is LIFO (last in, first out / stack).
 *  If steps were: A → B → C → D (fails), then compensate: C, B, A.
 *  Never compensate in the order they were executed.
 *
 * Why LIFO?
 *  B may depend on A's effects. If we undo A first, undoing B might fail
 *  because B's preconditions are gone.
 *
 * Real-world analogy: booking a flight, hotel, car rental.
 *  Car rental fails → cancel hotel → cancel flight (reverse order).
 *  Cancelling the flight first might prevent the hotel from being found.
 */

import { EventBus } from '../../src/shared/EventBus';
import { OrderSaga, InventoryService, PaymentService, ShippingService } from '../../src/04-saga/OrderSaga';

describe('04-saga / 02-compensation', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ─── Compensation triggered on failure ───────────────────────────────────────

  it('compensates completed steps when a later step fails', async () => {
    const compensated: string[] = [];

    const inventory: InventoryService = {
      reserve: () => Promise.resolve(),
      release: async () => { compensated.push('ReleaseInventory'); },
    };
    const payment: PaymentService = {
      charge: () => Promise.resolve(),
      refund: async () => { compensated.push('RefundPayment'); },
    };
    const shipping: ShippingService = {
      schedule: () => Promise.reject(new Error('Shipping unavailable')),
      cancel: async () => { compensated.push('CancelShipping'); },
    };

    const saga = new OrderSaga(inventory, payment, shipping, bus);
    const context = await saga.execute({ orderId: 'o1', customerId: 'c1', amount: 100, items: [] });

    // Shipping failed → compensate payment and inventory (not shipping — it never committed).
    // Compensation must be in LIFO order.
    expect(compensated).toEqual(['RefundPayment', 'ReleaseInventory']);
    expect(context.status).toBe('failed');
    expect(context.failedStep).toBe('ScheduleShipping');
  });

  it('only compensates steps that actually ran — not the failed step itself', async () => {
    const compensated: string[] = [];

    const inventory: InventoryService = {
      reserve: () => Promise.resolve(),
      release: async () => { compensated.push('ReleaseInventory'); },
    };
    const payment: PaymentService = {
      charge: () => Promise.reject(new Error('Card declined')),
      refund: async () => { compensated.push('RefundPayment'); }, // should NOT be called
    };
    const shipping: ShippingService = {
      schedule: () => Promise.resolve(),
      cancel: async () => { compensated.push('CancelShipping'); },
    };

    const saga = new OrderSaga(inventory, payment, shipping, bus);
    await saga.execute({ orderId: 'o1', customerId: 'c1', amount: 100, items: [] });

    // Only inventory ran — only inventory is compensated.
    // Payment failed so it's never compensated. Shipping never ran.
    expect(compensated).toEqual(['ReleaseInventory']);
    expect(compensated).not.toContain('RefundPayment');
    expect(compensated).not.toContain('CancelShipping');
  });

  it('no compensation when the first step fails (nothing to undo)', async () => {
    const compensated: string[] = [];

    const inventory: InventoryService = {
      reserve: () => Promise.reject(new Error('Out of stock')),
      release: async () => { compensated.push('ReleaseInventory'); },
    };
    const payment: PaymentService = {
      charge: () => Promise.resolve(),
      refund: async () => { compensated.push('RefundPayment'); },
    };
    const shipping: ShippingService = {
      schedule: () => Promise.resolve(),
      cancel: async () => { compensated.push('CancelShipping'); },
    };

    const saga = new OrderSaga(inventory, payment, shipping, bus);
    const context = await saga.execute({ orderId: 'o1', customerId: 'c1', amount: 100, items: [] });

    expect(compensated).toHaveLength(0);
    expect(context.failedStep).toBe('ReserveInventory');
  });

  // ─── LIFO compensation order ──────────────────────────────────────────────────

  it('compensation runs in LIFO order — not the order steps were executed', async () => {
    const executionLog: string[] = [];

    const inventory: InventoryService = {
      reserve: async () => { executionLog.push('execute:ReserveInventory'); },
      release: async () => { executionLog.push('compensate:ReleaseInventory'); },
    };
    const payment: PaymentService = {
      charge: async () => { executionLog.push('execute:ChargePayment'); },
      refund: async () => { executionLog.push('compensate:RefundPayment'); },
    };
    const shipping: ShippingService = {
      schedule: () => Promise.reject(new Error('No slots')),
      cancel: async () => { executionLog.push('compensate:CancelShipping'); },
    };

    const saga = new OrderSaga(inventory, payment, shipping, bus);
    await saga.execute({ orderId: 'o1', customerId: 'c1', amount: 100, items: [] });

    expect(executionLog).toEqual([
      'execute:ReserveInventory',
      'execute:ChargePayment',
      // Shipping failed — compensation starts here in REVERSE order:
      'compensate:RefundPayment',    // last successful step compensated first
      'compensate:ReleaseInventory', // first successful step compensated last
    ]);
  });

  // ─── EventBus: SagaFailed event ───────────────────────────────────────────────

  it('publishes SagaFailed event when any step fails', async () => {
    let failedEvent: unknown = null;
    bus.subscribe('SagaFailed', (e) => { failedEvent = e; });

    const inventory: InventoryService = {
      reserve: () => Promise.resolve(),
      release: () => Promise.resolve(),
    };
    const payment: PaymentService = {
      charge: () => Promise.reject(new Error('Declined')),
      refund: () => Promise.resolve(),
    };
    const shipping: ShippingService = {
      schedule: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    };

    const saga = new OrderSaga(inventory, payment, shipping, bus);
    await saga.execute({ orderId: 'order-fail', customerId: 'c1', amount: 50, items: [] });

    expect(failedEvent).toMatchObject({ sagaId: 'order-fail', failedStep: 'ChargePayment' });
  });
});
