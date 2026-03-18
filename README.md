# Event-Driven Architecture — Studies

A test-first, educational exploration of EDA patterns. Each pattern lives in its own folder with working TypeScript code and tests written as living documentation — the comments teach the concept, the assertions demonstrate it.

## Stack

- **Node.js 20 + TypeScript** (strict mode)
- **Jest + ts-jest** as test runner
- **In-memory implementations** — no Docker or external brokers needed

## Patterns

| # | Pattern | Core concept |
|---|---|---|
| 01 | Event Sourcing | State derived from an immutable event log |
| 02 | CQRS | Commands mutate; queries read — never both |
| 03 | Message Broker | Temporal decoupling via a persistent topic log |
| 04 | Saga | Distributed transactions via compensation (LIFO) |
| 05 | Outbox | Atomic write to DB + broker via an outbox table |

## Learning path

```
01-event-sourcing  →  EventStore, aggregate, event as immutable fact
02-cqrs            →  reuses EventStore + BankAccount; adds EventBus, projections
03-message-broker  →  reuses EventBus; adds offsets, consumer groups, at-least-once
04-saga            →  reuses EventBus; adds compensation, distributed coordination
05-outbox          →  reuses EventBus + broker concepts; solves the dual-write problem
```

## Running tests

```bash
npm test                  # all 93 tests
npm run test:verbose      # full output — reads like a concept index
npm run test:01           # Event Sourcing only
npm run test:02           # CQRS only
npm run test:03           # Message Broker only
npm run test:04           # Saga only
npm run test:05           # Outbox only

# Single file
npx jest tests/01-event-sourcing/01-basics.test.ts
```

## Structure

```
src/
  shared/
    EventBus.ts       # sync publish() + async publishAsync()
    EventStore.ts     # append-only in-memory store with optimistic concurrency
  01-event-sourcing/
    EventSourcedAggregate.ts
    BankAccount.ts
  02-cqrs/
    CommandBus.ts
    QueryBus.ts
    WriteModel.ts
    ReadModel.ts
  03-message-broker/
    InMemoryBroker.ts
    Producer.ts
    Consumer.ts
  04-saga/
    SagaOrchestrator.ts
    OrderSaga.ts
  05-outbox/
    OutboxStore.ts
    OutboxRelay.ts
    OrderService.ts

tests/
  01-event-sourcing/
    01-basics.test.ts          # immutable facts, state from events
    02-replay.test.ts          # rehydration, optimistic concurrency
    03-snapshots.test.ts       # performance optimisation, never replaces the log
  02-cqrs/
    01-command-query-separation.test.ts
    02-projections.test.ts     # eventual read model, rebuild from log
    03-combined-flow.test.ts   # full loop: Command → Store → Bus → Projection → Query
  03-message-broker/
    01-pubsub-basics.test.ts   # fan-out, temporal decoupling
    02-consumer-groups.test.ts # fan-out vs load balancing, offset tracking
    03-at-least-once-delivery.test.ts  # delivery guarantees, idempotency
  04-saga/
    01-happy-path.test.ts      # orchestration, SagaCompleted event
    02-compensation.test.ts    # LIFO compensation order
    03-partial-failure.test.ts # saga as state machine, stuck saga scenario
  05-outbox/
    01-atomic-write.test.ts    # DB + outbox in one "transaction"
    02-relay-delivery.test.ts  # relay bridge, at-least-once, retry
    03-dual-write-problem.test.ts  # counter-example: the bug the outbox solves
```
