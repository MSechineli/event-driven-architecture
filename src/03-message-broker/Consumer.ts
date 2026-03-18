import { InMemoryBroker, BrokerMessage } from './InMemoryBroker';

export type MessageProcessor<T = unknown> = (message: BrokerMessage<T>) => boolean | Promise<boolean>;

/**
 * Consumer: polls a topic and processes messages for a given consumer group.
 *
 * Offset management:
 *  The consumer commits the offset AFTER successfully processing a message.
 *  If processing fails (handler returns false / throws), the offset is NOT
 *  committed — the message will be re-delivered on the next poll (at-least-once).
 *
 * Idempotency:
 *  Because at-least-once means duplicates can happen (e.g. commit lost after crash),
 *  the message processor MUST be idempotent — processing the same message twice
 *  should produce the same result as processing it once.
 */
export class Consumer {
  private processed = 0;
  private failed = 0;

  constructor(
    private readonly broker: InMemoryBroker,
    private readonly topic: string,
    private readonly groupId: string
  ) {}

  async poll<T = unknown>(processor: MessageProcessor<T>): Promise<void> {
    const messages = this.broker.poll<T>(this.topic, this.groupId);
    for (const message of messages) {
      try {
        const success = await processor(message);
        if (success) {
          this.broker.commit(this.topic, this.groupId, message.offset);
          this.processed += 1;
        } else {
          this.failed += 1;
        }
      } catch {
        this.failed += 1;
        // Do NOT commit — message will be redelivered
      }
    }
  }

  getStats(): { processed: number; failed: number } {
    return { processed: this.processed, failed: this.failed };
  }

  getCommittedOffset(): number {
    return this.broker.getCommittedOffset(this.topic, this.groupId);
  }
}
