import { OutboxStore } from './OutboxStore';
import { EventBus } from '../shared/EventBus';

/**
 * Outbox Relay — the polling bridge between the outbox table and the message broker.
 *
 * Responsibilities:
 *  1. Poll the outbox for pending entries.
 *  2. Publish each entry to the EventBus (the "broker" in our in-memory world).
 *  3. Mark successfully published entries as 'delivered'.
 *  4. On failure, leave the entry as 'pending' so it will be retried.
 *
 * Delivery guarantee:
 *  At-least-once — if the relay publishes but crashes before marking 'delivered',
 *  the entry will be re-published on the next poll cycle. Consumers MUST be
 *  idempotent (use a dedupe key / event id).
 *
 * In production the relay is typically:
 *  - A background worker polling every N seconds, OR
 *  - A CDC (Change Data Capture) connector watching the DB transaction log.
 */
export class OutboxRelay {
  private deliveredCount = 0;
  private failedCount = 0;
  private brokerFailureSimulated = false;

  constructor(
    private readonly outbox: OutboxStore,
    private readonly bus: EventBus
  ) {}

  /** Simulate a transient broker failure on the next relay cycle. */
  simulateBrokerFailure(): void {
    this.brokerFailureSimulated = true;
  }

  async relay(): Promise<void> {
    const pending = this.outbox.getPending();

    for (const entry of pending) {
      if (this.brokerFailureSimulated) {
        this.brokerFailureSimulated = false;
        this.outbox.markFailed(entry.id);
        this.failedCount += 1;
        continue;
      }

      try {
        this.bus.publish(entry.eventType, {
          aggregateId: entry.aggregateId,
          payload: entry.payload,
          outboxId: entry.id,
        });
        this.outbox.markDelivered(entry.id);
        this.deliveredCount += 1;
      } catch {
        this.outbox.markFailed(entry.id);
        this.failedCount += 1;
      }
    }
  }

  getStats(): { delivered: number; failed: number } {
    return { delivered: this.deliveredCount, failed: this.failedCount };
  }
}
