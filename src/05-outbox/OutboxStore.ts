export type OutboxStatus = 'pending' | 'delivered' | 'failed';

export interface OutboxEntry {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  status: OutboxStatus;
  createdAt: Date;
  deliveredAt?: Date;
  retries: number;
}

/**
 * Outbox store — the "O" in the Outbox Pattern.
 *
 * The core idea: instead of writing to the database AND publishing to the broker
 * in two separate operations (dual-write — see tests/05-outbox/03-dual-write-problem),
 * we write the event to an "outbox" table IN THE SAME DATABASE TRANSACTION as
 * the business data change.
 *
 * Atomicity guarantee:
 *  In a real system: the outbox entry and the domain change are in one ACID tx.
 *  In JS (single-threaded): we simulate this by doing both writes synchronously
 *  before yielding control. There is no interleaving between two sync operations.
 *
 * A separate Relay process (OutboxRelay.ts) reads pending entries and forwards
 * them to the broker. If the relay crashes, entries remain 'pending' and are
 * retried — at-least-once delivery.
 */
export class OutboxStore {
  private entries: OutboxEntry[] = [];
  private idCounter = 0;

  /** Append an outbox entry (called inside the "transaction"). */
  append(aggregateId: string, eventType: string, payload: unknown): OutboxEntry {
    const entry: OutboxEntry = {
      id: String(++this.idCounter),
      aggregateId,
      eventType,
      payload,
      status: 'pending',
      createdAt: new Date(),
      retries: 0,
    };
    this.entries.push(entry);
    return entry;
  }

  getPending(): OutboxEntry[] {
    return this.entries.filter((e) => e.status === 'pending');
  }

  getAll(): OutboxEntry[] {
    return [...this.entries];
  }

  markDelivered(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.status = 'delivered';
      entry.deliveredAt = new Date();
    }
  }

  markFailed(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.retries += 1;
      // Keep as 'pending' so it will be retried — not marking as 'failed'
      // unless a max-retry policy is implemented
    }
  }
}
