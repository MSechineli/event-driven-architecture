export interface Query {
  readonly type: string;
}

export type QueryHandler<TQuery extends Query = Query, TResult = unknown> = (
  query: TQuery
) => TResult | Promise<TResult>;

/**
 * Routes queries to their single registered handler.
 *
 * CQRS rule: a query READS state and returns data.
 *  - Queries MUST NOT mutate any state (no side effects).
 *  - Queries read from the Read Model (projection), not from the event store.
 *  - This separation allows the read side to be independently scaled/optimised.
 */
export class QueryBus {
  private handlers = new Map<string, QueryHandler>();

  register<TQuery extends Query, TResult>(
    type: string,
    handler: QueryHandler<TQuery, TResult>
  ): void {
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for query type: ${type}`);
    }
    this.handlers.set(type, handler as QueryHandler);
  }

  async execute<TResult = unknown>(query: { readonly type: string; [key: string]: unknown }): Promise<TResult> {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(`No handler registered for query type: ${query.type}`);
    }
    return (await handler(query)) as TResult;
  }
}
