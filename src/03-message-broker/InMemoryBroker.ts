export interface BrokerMessage<T = unknown> {
  readonly topic: string;
  readonly payload: T;
  readonly offset: number;
  readonly producedAt: Date;
  readonly key?: string;
}

export interface ConsumerGroupState {
  /** The offset of the NEXT message to consume (i.e. last committed offset + 1). */
  committedOffset: number;
}

/**
 * In-memory message broker — models core Kafka/RabbitMQ concepts.
 *
 * Topics:
 *  An append-only log of messages. Each message gets a monotonically
 *  increasing offset. The log is never compacted in this implementation.
 *
 * Consumer groups:
 *  Multiple independent consumers can read the same topic from different
 *  offsets. Each group tracks its own "committed offset" — the position
 *  up to which messages have been successfully processed.
 *
 *  Fan-out (pub/sub): use a different group name per consumer.
 *  Load balancing: share the same group name across consumer instances
 *                  (simulated here by partitioning by message key).
 *
 * Delivery guarantee:
 *  The broker delivers at-least-once. If a consumer crashes before
 *  committing its offset, the same messages will be redelivered.
 */
export class InMemoryBroker {
  private topics = new Map<string, BrokerMessage[]>();
  private consumerGroups = new Map<string, ConsumerGroupState>();

  produce<T = unknown>(topic: string, payload: T, key?: string): BrokerMessage<T> {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }
    const log = this.topics.get(topic)!;
    const message: BrokerMessage<T> = {
      topic,
      payload,
      offset: log.length,
      producedAt: new Date(),
      key,
    };
    log.push(message as BrokerMessage);
    return message;
  }

  /**
   * Returns all messages from the committed offset onwards for a given group.
   * Does NOT advance the offset — call commit() after successful processing.
   */
  poll<T = unknown>(topic: string, groupId: string): BrokerMessage<T>[] {
    const log = (this.topics.get(topic) ?? []) as BrokerMessage<T>[];
    const groupKey = `${topic}::${groupId}`;
    const state = this.consumerGroups.get(groupKey) ?? { committedOffset: 0 };
    return log.filter((m) => m.offset >= state.committedOffset);
  }

  /** Advance the committed offset for a consumer group. */
  commit(topic: string, groupId: string, offset: number): void {
    const groupKey = `${topic}::${groupId}`;
    this.consumerGroups.set(groupKey, { committedOffset: offset + 1 });
  }

  /** Returns the committed offset for a group (0 if never committed). */
  getCommittedOffset(topic: string, groupId: string): number {
    const groupKey = `${topic}::${groupId}`;
    return this.consumerGroups.get(groupKey)?.committedOffset ?? 0;
  }

  getTopicLength(topic: string): number {
    return this.topics.get(topic)?.length ?? 0;
  }
}
