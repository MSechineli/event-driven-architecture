/**
 * SAGA PATTERN — Partial Failure & State Machine
 * ────────────────────────────────────────────────
 * Real-world sagas fail in surprising ways:
 *  - The business step fails (expected — handled by compensation).
 *  - The COMPENSATION itself fails (rare, serious — requires human intervention).
 *
 * When compensation fails, the saga is in an inconsistent state:
 *  - Some steps were committed.
 *  - Some compensations ran.
 *  - One compensation failed — some steps could not be undone.
 *
 * This is sometimes called "stuck saga" or "saga in limbo".
 * There is no automatic recovery — a human or ops team must intervene.
 *
 * Saga as a state machine:
 *  pending → running → completed        (happy path)
 *  pending → running → compensating → failed  (failure + compensation)
 *  pending → running → compensating → failed  (compensation also fails)
 *
 * The state machine view is useful: it makes every possible outcome explicit,
 * and prevents the saga from "getting lost" in an undefined state.
 */

import { EventBus } from '../../src/shared/EventBus';
import { SagaOrchestrator } from '../../src/04-saga/SagaOrchestrator';
import { OrderSaga, InventoryService, PaymentService, ShippingService } from '../../src/04-saga/OrderSaga';

describe('04-saga / 03-partial-failure', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ─── Saga as state machine ────────────────────────────────────────────────────

  it('starts in "pending" state', () => {
    const orchestrator = new SagaOrchestrator('saga-1');
    expect(orchestrator.getContext().status).toBe('pending');
  });

  it('transitions to "running" during execution', async () => {
    const statusDuringExecution: string[] = [];
    const orchestrator = new SagaOrchestrator('saga-1');

    await orchestrator.execute([
      {
        name: 'Step1',
        execute: () => { statusDuringExecution.push(orchestrator.getContext().status); },
        compensate: () => {},
      },
    ]);

    expect(statusDuringExecution).toContain('running');
  });

  it('transitions to "completed" after all steps succeed', async () => {
    const orchestrator = new SagaOrchestrator('saga-1');
    await orchestrator.execute([
      { name: 'A', execute: () => {}, compensate: () => {} },
      { name: 'B', execute: () => {}, compensate: () => {} },
    ]);
    expect(orchestrator.getContext().status).toBe('completed');
  });

  it('transitions through "compensating" before landing in "failed"', async () => {
    const statusLog: string[] = [];
    const orchestrator = new SagaOrchestrator('saga-1');

    await orchestrator.execute([
      {
        name: 'Step1',
        execute: () => {},
        compensate: () => { statusLog.push(orchestrator.getContext().status); },
      },
      {
        name: 'Step2',
        execute: () => { throw new Error('oops'); },
        compensate: () => {},
      },
    ]);

    expect(statusLog).toContain('compensating');
    expect(orchestrator.getContext().status).toBe('failed');
  });

  // ─── Compensation failure ─────────────────────────────────────────────────────

  it('marks saga as "failed" if a compensation step throws', async () => {
    const inventory: InventoryService = {
      reserve: () => Promise.resolve(),
      release: () => Promise.reject(new Error('Inventory service down — cannot release')),
    };
    const payment: PaymentService = {
      charge: () => Promise.reject(new Error('Card expired')),
      refund: () => Promise.resolve(),
    };
    const shipping: ShippingService = {
      schedule: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    };

    const saga = new OrderSaga(inventory, payment, shipping, bus);
    const context = await saga.execute({ orderId: 'o1', customerId: 'c1', amount: 100, items: [] });

    // Payment failed → try to compensate inventory → inventory compensation failed.
    expect(context.status).toBe('failed');
    expect(context.error).toContain('Compensation failed');
  });

  it('compensation failure records the problematic step in context', async () => {
    const orchestrator = new SagaOrchestrator('saga-1');

    await orchestrator.execute([
      {
        name: 'CreateOrder',
        execute: () => {},
        compensate: () => { throw new Error('DB unavailable'); },
      },
      {
        name: 'ReserveStock',
        execute: () => { throw new Error('Out of stock'); },
        compensate: () => {},
      },
    ]);

    const context = orchestrator.getContext();
    expect(context.status).toBe('failed');
    expect(context.error).toContain('CreateOrder');
    expect(context.error).toContain('DB unavailable');
  });

  // ─── Partial compensation ─────────────────────────────────────────────────────

  it('compensates steps that completed before the compensation failure', async () => {
    const compensated: string[] = [];
    const orchestrator = new SagaOrchestrator('saga-1');

    await orchestrator.execute([
      {
        name: 'StepA',
        execute: () => {},
        compensate: async () => { compensated.push('StepA'); },
      },
      {
        name: 'StepB',
        execute: () => {},
        compensate: () => { throw new Error('StepB compensation failed'); }, // this blocks further rollback
      },
      {
        name: 'StepC',
        execute: () => { throw new Error('StepC execute failed'); },
        compensate: () => {},
      },
    ]);

    // StepC failed → compensate StepB (throws — stops the chain) → StepA never reached.
    // This demonstrates the "stuck saga" scenario.
    expect(compensated).not.toContain('StepA'); // StepA was never compensated
    expect(orchestrator.getContext().status).toBe('failed');
  });

  // ─── No infinite retry ────────────────────────────────────────────────────────

  it('does not retry endlessly — saga terminates in "failed" state', async () => {
    let compensateAttempts = 0;
    const orchestrator = new SagaOrchestrator('saga-1');

    await orchestrator.execute([
      {
        name: 'Step1',
        execute: () => {},
        compensate: () => {
          compensateAttempts++;
          throw new Error('always fails');
        },
      },
      {
        name: 'Step2',
        execute: () => { throw new Error('fails'); },
        compensate: () => {},
      },
    ]);

    // Compensation attempted exactly once, then stopped — no retry loop.
    expect(compensateAttempts).toBe(1);
    expect(orchestrator.getContext().status).toBe('failed');
  });
});
