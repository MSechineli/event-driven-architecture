/**
 * SAGA PATTERN — Happy Path
 * ──────────────────────────
 * Problem: how do you maintain data consistency across multiple services
 * when you can't use a single distributed transaction?
 *
 * A distributed transaction (2PC) requires all participants to hold locks
 * until every participant has committed. This is slow and fragile.
 *
 * Saga: a sequence of LOCAL transactions, each publishing an event that
 * triggers the next step. Instead of locking, you design compensation logic
 * that can "undo" a committed step.
 *
 * Orchestration saga (this file):
 *  A central coordinator (SagaOrchestrator) knows the full sequence of steps
 *  and decides what to do next. Think of it as a state machine runner.
 *
 * Choreography saga (alternative):
 *  Each service reacts to events and produces the next event. No central brain.
 *  Harder to trace, easier to scale.
 *
 * Steps in the Order saga:
 *  1. ReserveInventory — lock stock for the order.
 *  2. ChargePayment    — debit the customer's account.
 *  3. ScheduleShipping — book a delivery slot.
 */

import { EventBus } from '../../src/shared/EventBus';
import { OrderSaga, InventoryService, PaymentService, ShippingService } from '../../src/04-saga/OrderSaga';

function makeServices(overrides: {
  reserve?: () => Promise<void>;
  charge?: () => Promise<void>;
  schedule?: () => Promise<void>;
} = {}): { inventory: InventoryService; payment: PaymentService; shipping: ShippingService } {
  return {
    inventory: {
      reserve: overrides.reserve ?? (() => Promise.resolve()),
      release: () => Promise.resolve(),
    },
    payment: {
      charge: overrides.charge ?? (() => Promise.resolve()),
      refund: () => Promise.resolve(),
    },
    shipping: {
      schedule: overrides.schedule ?? (() => Promise.resolve()),
      cancel: () => Promise.resolve(),
    },
  };
}

describe('04-saga / 01-happy-path', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ─── Successful saga execution ────────────────────────────────────────────────

  it('completes all steps when all services succeed', async () => {
    const services = makeServices();
    const saga = new OrderSaga(services.inventory, services.payment, services.shipping, bus);

    const context = await saga.execute({
      orderId: 'order-1',
      customerId: 'cust-1',
      amount: 150,
      items: ['item-A', 'item-B'],
    });

    expect(context.status).toBe('completed');
    expect(context.completedSteps).toEqual(['ReserveInventory', 'ChargePayment', 'ScheduleShipping']);
  });

  it('context tracks which steps were completed', async () => {
    const callLog: string[] = [];

    const services: { inventory: InventoryService; payment: PaymentService; shipping: ShippingService } = {
      inventory: {
        reserve: async () => { callLog.push('reserve'); },
        release: async () => {},
      },
      payment: {
        charge: async () => { callLog.push('charge'); },
        refund: async () => {},
      },
      shipping: {
        schedule: async () => { callLog.push('schedule'); },
        cancel: async () => {},
      },
    };

    const saga = new OrderSaga(services.inventory, services.payment, services.shipping, bus);
    const context = await saga.execute({ orderId: 'order-1', customerId: 'c1', amount: 100, items: [] });

    // Steps executed in the correct order.
    expect(callLog).toEqual(['reserve', 'charge', 'schedule']);
    expect(context.completedSteps).toEqual(['ReserveInventory', 'ChargePayment', 'ScheduleShipping']);
  });

  // ─── EventBus integration ─────────────────────────────────────────────────────

  it('publishes SagaCompleted event when all steps succeed', async () => {
    let sagaCompletedEvent: unknown = null;
    bus.subscribe('SagaCompleted', (event) => { sagaCompletedEvent = event; });

    const services = makeServices();
    const saga = new OrderSaga(services.inventory, services.payment, services.shipping, bus);
    await saga.execute({ orderId: 'order-42', customerId: 'c1', amount: 99, items: ['x'] });

    expect(sagaCompletedEvent).toMatchObject({ sagaId: 'order-42' });
  });

  it('does NOT publish SagaFailed on success', async () => {
    let failed = false;
    bus.subscribe('SagaFailed', () => { failed = true; });

    const services = makeServices();
    const saga = new OrderSaga(services.inventory, services.payment, services.shipping, bus);
    await saga.execute({ orderId: 'order-1', customerId: 'c1', amount: 10, items: [] });

    expect(failed).toBe(false);
  });

  // ─── Context content ──────────────────────────────────────────────────────────

  it('context contains the saga id', async () => {
    const services = makeServices();
    const saga = new OrderSaga(services.inventory, services.payment, services.shipping, bus);
    const context = await saga.execute({ orderId: 'saga-xyz', customerId: 'c1', amount: 50, items: [] });

    expect(context.sagaId).toBe('saga-xyz');
  });

  it('completed saga has no failedStep or error', async () => {
    const services = makeServices();
    const saga = new OrderSaga(services.inventory, services.payment, services.shipping, bus);
    const context = await saga.execute({ orderId: 'order-1', customerId: 'c1', amount: 10, items: [] });

    expect(context.failedStep).toBeUndefined();
    expect(context.error).toBeUndefined();
  });
});
