import { SagaOrchestrator, SagaContext, SagaStep } from './SagaOrchestrator';
import { EventBus } from '../shared/EventBus';

export interface OrderSagaInput {
  orderId: string;
  customerId: string;
  amount: number;
  items: string[];
}

// ── Simulated external services ────────────────────────────────────────────────

export interface InventoryService {
  reserve(orderId: string, items: string[]): Promise<void>;
  release(orderId: string): Promise<void>;
}

export interface PaymentService {
  charge(orderId: string, customerId: string, amount: number): Promise<void>;
  refund(orderId: string): Promise<void>;
}

export interface ShippingService {
  schedule(orderId: string): Promise<void>;
  cancel(orderId: string): Promise<void>;
}

/**
 * Place-Order saga: orchestrates inventory reservation, payment, and shipping.
 *
 * Happy path:  ReserveInventory → ChargePayment → ScheduleShipping → SagaCompleted
 * On failure:  compensate in reverse: CancelShipping → RefundPayment → ReleaseInventory
 *
 * The EventBus is used to broadcast saga lifecycle events so that other parts
 * of the system can react (e.g. sending a confirmation email on SagaCompleted).
 */
export class OrderSaga {
  constructor(
    private readonly inventory: InventoryService,
    private readonly payment: PaymentService,
    private readonly shipping: ShippingService,
    private readonly bus: EventBus
  ) {}

  async execute(input: OrderSagaInput): Promise<SagaContext> {
    const orchestrator = new SagaOrchestrator(input.orderId);

    const steps: SagaStep[] = [
      {
        name: 'ReserveInventory',
        execute: () => this.inventory.reserve(input.orderId, input.items),
        compensate: () => this.inventory.release(input.orderId),
      },
      {
        name: 'ChargePayment',
        execute: () => this.payment.charge(input.orderId, input.customerId, input.amount),
        compensate: () => this.payment.refund(input.orderId),
      },
      {
        name: 'ScheduleShipping',
        execute: () => this.shipping.schedule(input.orderId),
        compensate: () => this.shipping.cancel(input.orderId),
      },
    ];

    const context = await orchestrator.execute(steps);

    if (context.status === 'completed') {
      this.bus.publish('SagaCompleted', { sagaId: input.orderId, input });
    } else {
      this.bus.publish('SagaFailed', {
        sagaId: input.orderId,
        failedStep: context.failedStep,
        error: context.error,
      });
    }

    return context;
  }
}
