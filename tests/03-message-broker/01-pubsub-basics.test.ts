/**
 * MESSAGE BROKER — Pub/Sub Basics
 * ─────────────────────────────────
 * Message brokers decouple producers from consumers through a persistent log.
 *
 * Core concepts:
 *  TOPIC    — a named, append-only log of messages.
 *  PRODUCER — writes messages to a topic (doesn't know who reads them).
 *  CONSUMER — reads messages from a topic (doesn't know who wrote them).
 *
 * Temporal decoupling:
 *  Unlike a direct function call, the producer does not wait for consumers.
 *  A consumer can go offline and catch up when it comes back — the log persists.
 *
 * Fan-out (pub/sub):
 *  Multiple consumers can read the same topic independently.
 *  Each gets its own offset pointer — they don't interfere with each other.
 *
 * This is in contrast to work queues (load balancing), where multiple consumers
 * share a single offset and each message is processed by exactly one consumer.
 * See 02-consumer-groups.test.ts for the load-balancing model.
 */

import { InMemoryBroker } from '../../src/03-message-broker/InMemoryBroker';
import { Producer } from '../../src/03-message-broker/Producer';
import { Consumer } from '../../src/03-message-broker/Consumer';

describe('03-message-broker / 01-pubsub-basics', () => {
  let broker: InMemoryBroker;
  let producer: Producer;

  beforeEach(() => {
    broker = new InMemoryBroker();
    producer = new Producer(broker);
  });

  // ─── Producer ───────────────────────────────────────────────────────────────

  it('producer writes messages to a topic', () => {
    producer.send('orders', { orderId: 'o1', amount: 100 });
    producer.send('orders', { orderId: 'o2', amount: 200 });

    expect(broker.getTopicLength('orders')).toBe(2);
  });

  it('each message receives a monotonically increasing offset', () => {
    const o1 = producer.send('orders', { orderId: 'o1' });
    const o2 = producer.send('orders', { orderId: 'o2' });
    const o3 = producer.send('orders', { orderId: 'o3' });

    expect(o1).toBe(0);
    expect(o2).toBe(1);
    expect(o3).toBe(2);
  });

  it('messages are durable — they persist even if no consumer is active', () => {
    producer.send('orders', { orderId: 'o1' });
    producer.send('orders', { orderId: 'o2' });

    // No consumer has polled yet. Messages are still in the log.
    expect(broker.getTopicLength('orders')).toBe(2);
  });

  // ─── Consumer ───────────────────────────────────────────────────────────────

  it('consumer receives all messages from offset 0 on first poll', async () => {
    producer.send('orders', { orderId: 'o1' });
    producer.send('orders', { orderId: 'o2' });

    const consumer = new Consumer(broker, 'orders', 'group-A');
    const received: string[] = [];

    await consumer.poll((msg) => {
      received.push((msg.payload as { orderId: string }).orderId);
      return true;
    });

    expect(received).toEqual(['o1', 'o2']);
  });

  it('after committing, consumer resumes from where it left off', async () => {
    producer.send('orders', { orderId: 'o1' });
    producer.send('orders', { orderId: 'o2' });
    producer.send('orders', { orderId: 'o3' });

    const consumer = new Consumer(broker, 'orders', 'group-A');
    const round1: string[] = [];
    const round2: string[] = [];

    // Poll and commit o1 and o2.
    await consumer.poll((msg) => {
      const id = (msg.payload as { orderId: string }).orderId;
      if (id !== 'o3') { round1.push(id); return true; }
      return false; // don't commit o3 yet
    });

    // New message arrives.
    producer.send('orders', { orderId: 'o4' });

    // Second poll: o3 (not committed) + o4 (new).
    await consumer.poll((msg) => {
      round2.push((msg.payload as { orderId: string }).orderId);
      return true;
    });

    expect(round1).toEqual(['o1', 'o2']);
    expect(round2).toEqual(['o3', 'o4']);
  });

  // ─── Fan-out ─────────────────────────────────────────────────────────────────

  it('multiple consumers with different group IDs each receive all messages (fan-out)', async () => {
    producer.send('events', { type: 'UserSignedUp', userId: 'u1' });
    producer.send('events', { type: 'UserSignedUp', userId: 'u2' });

    const emailConsumer = new Consumer(broker, 'events', 'email-service');
    const analyticsConsumer = new Consumer(broker, 'events', 'analytics-service');

    const emailReceived: string[] = [];
    const analyticsReceived: string[] = [];

    await emailConsumer.poll((msg) => {
      emailReceived.push((msg.payload as { userId: string }).userId);
      return true;
    });

    await analyticsConsumer.poll((msg) => {
      analyticsReceived.push((msg.payload as { userId: string }).userId);
      return true;
    });

    // Both consumers received both messages independently.
    expect(emailReceived).toEqual(['u1', 'u2']);
    expect(analyticsReceived).toEqual(['u1', 'u2']);
  });

  it('one consumer committing does not affect another consumer group', async () => {
    producer.send('events', { type: 'A' });
    producer.send('events', { type: 'B' });

    const consumerA = new Consumer(broker, 'events', 'group-A');
    const consumerB = new Consumer(broker, 'events', 'group-B');

    // Group A polls and commits.
    await consumerA.poll(() => true);
    expect(consumerA.getCommittedOffset()).toBe(2);

    // Group B has not polled — its offset is still 0.
    expect(consumerB.getCommittedOffset()).toBe(0);

    // Group B polls and sees all messages from the beginning.
    const received: string[] = [];
    await consumerB.poll((msg) => {
      received.push((msg.payload as { type: string }).type);
      return true;
    });
    expect(received).toEqual(['A', 'B']);
  });
});
