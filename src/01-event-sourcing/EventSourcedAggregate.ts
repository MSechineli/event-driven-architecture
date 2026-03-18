import { DomainEvent, EventStore } from '../shared/EventStore';

export interface Snapshot<TState> {
  aggregateId: string;
  version: number;
  state: TState;
  takenAt: Date;
}

/**
 * Base class for event-sourced aggregates.
 *
 * An aggregate reconstructs its state by replaying its own events.
 * It never stores "current state" in a database column — the event log IS the truth.
 *
 * apply()   — called both when raising a new event AND when replaying history.
 *             Must be a pure function: no side effects, no I/O.
 * raise()   — records a new event in the store and applies it immediately.
 * rehydrate() — rebuilds state from an event log (optionally from a snapshot).
 */
export abstract class EventSourcedAggregate<TState> {
  protected state!: TState;
  protected version = 0;

  constructor(
    protected readonly id: string,
    protected readonly store: EventStore
  ) {}

  protected abstract apply(event: DomainEvent): void;
  protected abstract initialState(): TState;

  protected raise(type: string, payload: unknown): DomainEvent {
    const event = this.store.append({
      aggregateId: this.id,
      type,
      payload,
      version: this.version + 1,
    });
    this.apply(event);
    this.version = event.version;
    return event;
  }

  rehydrate(fromSnapshot?: Snapshot<unknown>): void {
    if (fromSnapshot) {
      this.state = Object.assign({}, fromSnapshot.state) as TState;
      this.version = fromSnapshot.version;
    } else {
      this.state = this.initialState();
      this.version = 0;
    }

    const events = this.store.getEvents(this.id).filter((e) => e.version > this.version);
    for (const event of events) {
      this.apply(event);
      this.version = event.version;
    }
  }

  takeSnapshot(): Snapshot<TState> {
    return {
      aggregateId: this.id,
      version: this.version,
      state: { ...this.state },
      takenAt: new Date(),
    };
  }

  getVersion(): number {
    return this.version;
  }
}
