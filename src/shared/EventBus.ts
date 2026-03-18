export type EventHandler<T = unknown> = (event: T) => void;
export type AsyncEventHandler<T = unknown> = (event: T) => Promise<void>;

/**
 * In-memory pub/sub event bus.
 *
 * publish()      — synchronous fan-out; all subscribers run before the call returns.
 *                  Used by CQRS projections that must be up-to-date immediately.
 *
 * publishAsync() — async fan-out via Promise.all; all subscribers are awaited in
 *                  parallel. Used by broker/outbox tests that need to simulate
 *                  async delivery and timing behaviour.
 */
export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private asyncHandlers = new Map<string, AsyncEventHandler[]>();

  subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler as EventHandler);
  }

  subscribeAsync<T = unknown>(eventType: string, handler: AsyncEventHandler<T>): void {
    if (!this.asyncHandlers.has(eventType)) {
      this.asyncHandlers.set(eventType, []);
    }
    this.asyncHandlers.get(eventType)!.push(handler as AsyncEventHandler);
  }

  publish<T = unknown>(eventType: string, event: T): void {
    const handlers = this.handlers.get(eventType) ?? [];
    for (const handler of handlers) {
      handler(event);
    }
  }

  async publishAsync<T = unknown>(eventType: string, event: T): Promise<void> {
    const handlers = this.asyncHandlers.get(eventType) ?? [];
    await Promise.all(handlers.map((h) => h(event)));
  }

  /** Remove all subscriptions — useful for test teardown. */
  clear(): void {
    this.handlers.clear();
    this.asyncHandlers.clear();
  }
}
