/**
 * MESSAGE BROKER — At-Least-Once Delivery
 * ─────────────────────────────────────────
 * Delivery guarantees define what happens when things go wrong:
 *
 *  At-most-once:  message may be lost, never duplicated (fire and forget).
 *  At-least-once: message is never lost, but may be duplicated on retry.
 *  Exactly-once:  message is delivered exactly once (expensive, rare).
 *
 * Most production systems choose at-least-once because:
 *  - Losing messages is unacceptable (financial, audit, compliance).
 *  - Duplicate messages can be handled with idempotency (much cheaper).
 *
 * How at-least-once works:
 *  1. Consumer receives message.
 *  2. Consumer processes it.
 *  3. Consumer commits offset (ack to broker).
 *  If the consumer crashes between steps 2 and 3, the broker will redeliver
 *  the same message — resulting in a duplicate.
 *
 * Idempotency as the solution:
 *  An operation is idempotent if applying it multiple times has the same
 *  effect as applying it once. Examples:
 *   - Setting a value: SET balance=100 (idempotent)
 *   - Adding a value: balance += 50 (NOT idempotent — each duplicate adds more)
 *  Use a deduplicate table or natural idempotency keys to handle duplicates.
 */

import { InMemoryBroker } from '../../src/03-message-broker/InMemoryBroker';
import { Producer } from '../../src/03-message-broker/Producer';
import { Consumer } from '../../src/03-message-broker/Consumer';

describe('03-message-broker / 03-at-least-once-delivery', () => {
  let broker: InMemoryBroker;
  let producer: Producer;

  beforeEach(() => {
    broker = new InMemoryBroker();
    producer = new Producer(broker);
  });

  // ─── At-least-once: uncommitted messages are redelivered ────────────────────

  it('unprocessed messages are redelivered on subsequent polls', async () => {
    producer.send('payments', { paymentId: 'p1', amount: 100 });

    const consumer = new Consumer(broker, 'payments', 'processor');

    // First poll: simulate crash — message received but not committed.
    const firstAttempts: string[] = [];
    await consumer.poll((msg) => {
      firstAttempts.push((msg.payload as { paymentId: string }).paymentId);
      return false; // return false = don't commit (simulate failure)
    });

    // Second poll: same message is delivered again.
    const secondAttempts: string[] = [];
    const consumer2 = new Consumer(broker, 'payments', 'processor'); // same group
    await consumer2.poll((msg) => {
      secondAttempts.push((msg.payload as { paymentId: string }).paymentId);
      return true; // this time we commit
    });

    expect(firstAttempts).toEqual(['p1']);
    expect(secondAttempts).toEqual(['p1']); // redelivered!
  });

  it('messages after the last committed offset are redelivered, earlier ones are not', async () => {
    producer.send('events', { id: 1 }); // offset 0
    producer.send('events', { id: 2 }); // offset 1
    producer.send('events', { id: 3 }); // offset 2

    const consumer = new Consumer(broker, 'events', 'group-A');

    // Process messages 1 and 2 successfully; fail on 3.
    await consumer.poll((msg) => {
      return (msg.payload as { id: number }).id !== 3;
    });
    expect(consumer.getCommittedOffset()).toBe(2); // committed up to offset 1

    // Next poll: only message 3 is redelivered (1 and 2 were committed).
    const redelivered: number[] = [];
    await consumer.poll((msg) => {
      redelivered.push((msg.payload as { id: number }).id);
      return true;
    });

    expect(redelivered).toEqual([3]);
  });

  // ─── Idempotency: handling duplicates safely ──────────────────────────────────

  it('non-idempotent handler produces wrong result on duplicate delivery', async () => {
    producer.send('deposits', { depositId: 'd1', amount: 100 });

    let balance = 0;
    const consumer = new Consumer(broker, 'deposits', 'bank');

    // First delivery — processed correctly.
    await consumer.poll((msg) => {
      balance += (msg.payload as { amount: number }).amount; // += is NOT idempotent
      return false; // crash before commit!
    });
    expect(balance).toBe(100);

    // Duplicate delivery — balance is now wrong.
    const consumer2 = new Consumer(broker, 'deposits', 'bank'); // same group, restarted
    await consumer2.poll((msg) => {
      balance += (msg.payload as { amount: number }).amount;
      return true;
    });

    // Bug! The deposit was applied twice.
    expect(balance).toBe(200); // should be 100
  });

  it('idempotent handler produces correct result even on duplicate delivery', async () => {
    producer.send('deposits', { depositId: 'd1', amount: 100 });

    const processedIds = new Set<string>();
    let balance = 0;

    const idempotentProcessor = (msg: { payload: unknown }) => {
      const { depositId, amount } = msg.payload as { depositId: string; amount: number };
      if (processedIds.has(depositId)) {
        return true; // already processed — skip, but ack
      }
      balance += amount;
      processedIds.add(depositId);
      return true;
    };

    const consumer = new Consumer(broker, 'deposits', 'bank');
    await consumer.poll((msg) => {
      idempotentProcessor(msg);
      return false; // crash before commit
    });

    // Duplicate — but idempotent handler ignores it.
    const consumer2 = new Consumer(broker, 'deposits', 'bank');
    await consumer2.poll((msg) => {
      idempotentProcessor(msg);
      return true;
    });

    // Correct! The set acts as a dedupe log.
    expect(balance).toBe(100);
  });

  // ─── Committed messages are never redelivered ─────────────────────────────────

  it('committed messages are not redelivered on the next poll', async () => {
    producer.send('tasks', { taskId: 't1' });
    producer.send('tasks', { taskId: 't2' });

    const consumer = new Consumer(broker, 'tasks', 'workers');
    const round1: string[] = [];
    const round2: string[] = [];

    await consumer.poll((msg) => {
      round1.push((msg.payload as { taskId: string }).taskId);
      return true; // commit both
    });

    producer.send('tasks', { taskId: 't3' }); // new message

    await consumer.poll((msg) => {
      round2.push((msg.payload as { taskId: string }).taskId);
      return true;
    });

    expect(round1).toEqual(['t1', 't2']);
    expect(round2).toEqual(['t3']); // only the new one, not t1/t2
  });
});
