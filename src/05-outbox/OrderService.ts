import { OutboxStore } from './OutboxStore';

export interface Order {
  id: string;
  customerId: string;
  amount: number;
  status: 'pending' | 'confirmed';
  createdAt: Date;
}

/**
 * Order service — demonstrates atomic write via the Outbox Pattern.
 *
 * createOrder() does TWO things in the same synchronous block (simulating one DB tx):
 *  1. Persists the Order record to the in-memory orders store.
 *  2. Appends an 'OrderCreated' entry to the Outbox store.
 *
 * Because JS is single-threaded, no other code runs between these two lines.
 * In a real system this would be wrapped in a database transaction:
 *
 *   BEGIN;
 *     INSERT INTO orders (...)  VALUES (...);
 *     INSERT INTO outbox (...)  VALUES (...);
 *   COMMIT;
 *
 * Either BOTH succeed or NEITHER does — the outbox entry is guaranteed to exist
 * whenever the order exists. The relay then delivers it to the broker asynchronously.
 */
export class OrderService {
  private orders = new Map<string, Order>();

  constructor(private readonly outbox: OutboxStore) {}

  /** Atomic write: save order + append outbox entry in one "transaction". */
  createOrder(id: string, customerId: string, amount: number): Order {
    // Step 1: business data
    const order: Order = {
      id,
      customerId,
      amount,
      status: 'pending',
      createdAt: new Date(),
    };
    this.orders.set(id, order);

    // Step 2: outbox entry (same transaction)
    this.outbox.append(id, 'OrderCreated', { orderId: id, customerId, amount });

    return order;
  }

  getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }
}
