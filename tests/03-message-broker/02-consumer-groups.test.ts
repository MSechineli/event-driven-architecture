/**
 * MESSAGE BROKER — Consumer Groups
 * ──────────────────────────────────
 * Consumer groups are how brokers support BOTH pub/sub AND load balancing
 * with the same underlying topic abstraction.
 *
 * Fan-out (pub/sub):  group-A and group-B both consume all messages.
 *                     Use case: email service + analytics service reading orders.
 *
 * Load balancing:     multiple instances of group-A share the work.
 *                     Use case: 3 worker instances processing the same queue.
 *                     Each message should be processed by exactly ONE instance.
 *
 * Offset tracking:
 *  Each consumer group maintains a "committed offset" — the position up to
 *  which it has successfully processed messages. On restart, the consumer
 *  resumes from this position, not from the beginning.
 *
 * In Kafka: offsets are stored in a special __consumer_offsets topic.
 * In our in-memory broker: offsets are stored in a Map.
 */

import { InMemoryBroker } from '../../src/03-message-broker/InMemoryBroker';
import { Producer } from '../../src/03-message-broker/Producer';
import { Consumer } from '../../src/03-message-broker/Consumer';

describe('03-message-broker / 02-consumer-groups', () => {
  let broker: InMemoryBroker;
  let producer: Producer;

  beforeEach(() => {
    broker = new InMemoryBroker();
    producer = new Producer(broker);
  });

  // ─── Offset management ───────────────────────────────────────────────────────

  it('offset starts at 0 before any messages are committed', () => {
    const consumer = new Consumer(broker, 'orders', 'group-A');
    expect(consumer.getCommittedOffset()).toBe(0);
  });

  it('committed offset advances after successful processing', async () => {
    producer.send('orders', { id: 1 });
    producer.send('orders', { id: 2 });
    producer.send('orders', { id: 3 });

    const consumer = new Consumer(broker, 'orders', 'group-A');
    await consumer.poll(() => true); // process and commit all

    // Offset is now 3: the next message to poll will be at offset 3.
    expect(consumer.getCommittedOffset()).toBe(3);
  });

  it('consumer resumes from committed offset after a simulated restart', async () => {
    producer.send('orders', { id: 1 }); // offset 0
    producer.send('orders', { id: 2 }); // offset 1
    producer.send('orders', { id: 3 }); // offset 2

    // First consumer instance processes messages 0 and 1, commits offset=2.
    const instance1 = new Consumer(broker, 'orders', 'group-A');
    let count = 0;
    await instance1.poll((msg) => {
      count++;
      return count <= 2; // commit only the first two
    });

    // Simulate restart: new Consumer instance, same groupId.
    const instance2 = new Consumer(broker, 'orders', 'group-A');
    const received: number[] = [];
    await instance2.poll((msg) => {
      received.push((msg.payload as { id: number }).id);
      return true;
    });

    // Instance2 starts from the last committed offset — it sees only message 3.
    expect(received).toEqual([3]);
  });

  // ─── Fan-out: different groups see all messages ───────────────────────────────

  it('two groups with different IDs each consume all messages independently', async () => {
    producer.send('payments', { amount: 100 });
    producer.send('payments', { amount: 200 });

    const reporting = new Consumer(broker, 'payments', 'reporting');
    const fraud = new Consumer(broker, 'payments', 'fraud-detection');

    const reportingAmounts: number[] = [];
    const fraudAmounts: number[] = [];

    await reporting.poll((msg) => {
      reportingAmounts.push((msg.payload as { amount: number }).amount);
      return true;
    });

    await fraud.poll((msg) => {
      fraudAmounts.push((msg.payload as { amount: number }).amount);
      return true;
    });

    expect(reportingAmounts).toEqual([100, 200]);
    expect(fraudAmounts).toEqual([100, 200]);
  });

  // ─── Load balancing: same group processes each message once ──────────────────

  it('simulates load balancing: messages with different keys go to different consumers', async () => {
    // In Kafka, partitioning by key ensures that consumer-A always handles
    // orders for customer-1, and consumer-B handles orders for customer-2.
    // Here we simulate this by manually splitting by key.
    producer.send('orders', { customerId: 'c1', orderId: 'o1' }, 'c1');
    producer.send('orders', { customerId: 'c2', orderId: 'o2' }, 'c2');
    producer.send('orders', { customerId: 'c1', orderId: 'o3' }, 'c1');

    // Both consumers share the same group — in a real broker only one would
    // receive each message. Here we simulate the key-based routing manually.
    const allMessages = broker.poll('orders', 'workers');
    const workerA = allMessages.filter((m) => m.key === 'c1');
    const workerB = allMessages.filter((m) => m.key === 'c2');

    expect(workerA.map((m) => (m.payload as { orderId: string }).orderId)).toEqual(['o1', 'o3']);
    expect(workerB.map((m) => (m.payload as { orderId: string }).orderId)).toEqual(['o2']);

    // Combined: all messages processed once total (no duplication).
    expect(workerA.length + workerB.length).toBe(allMessages.length);
  });

  // ─── Stats ───────────────────────────────────────────────────────────────────

  it('tracks processed and failed message counts', async () => {
    producer.send('jobs', { id: 1 });
    producer.send('jobs', { id: 2 });
    producer.send('jobs', { id: 3 });

    const consumer = new Consumer(broker, 'jobs', 'worker');
    await consumer.poll((msg) => {
      // Fail message with id=2.
      return (msg.payload as { id: number }).id !== 2;
    });

    const stats = consumer.getStats();
    expect(stats.processed).toBe(2); // id 1 and 3
    expect(stats.failed).toBe(1);    // id 2
  });
});
