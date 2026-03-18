export interface DomainEvent {
  readonly aggregateId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly version: number;
  readonly occurredAt: Date;
}

/**
 * Append-only in-memory event store.
 *
 * Core rules of event sourcing:
 *  1. Events are immutable facts — never updated or deleted.
 *  2. Current state is always derivable by replaying events in order.
 *  3. Version is monotonically increasing per aggregate.
 *
 * optimistic concurrency: append() rejects if the expected version doesn't
 * match — this prevents two concurrent writers from creating conflicting state.
 */
export class EventStore {
  private events: DomainEvent[] = [];

  append(event: Omit<DomainEvent, 'occurredAt'>, expectedVersion?: number): DomainEvent {
    if (expectedVersion !== undefined) {
      const current = this.getVersion(event.aggregateId);
      if (current !== expectedVersion) {
        throw new Error(
          `Optimistic concurrency conflict: expected version ${expectedVersion}, got ${current}`
        );
      }
    }

    const stored: DomainEvent = { ...event, occurredAt: new Date() };
    this.events.push(stored);
    return stored;
  }

  getEvents(aggregateId: string): DomainEvent[] {
    return this.events.filter((e) => e.aggregateId === aggregateId);
  }

  getAllEvents(): DomainEvent[] {
    return [...this.events];
  }

  getVersion(aggregateId: string): number {
    const events = this.getEvents(aggregateId);
    if (events.length === 0) return 0;
    return events[events.length - 1].version;
  }
}
