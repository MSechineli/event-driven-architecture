import { InMemoryBroker } from './InMemoryBroker';

/**
 * Producer: publishes messages to a topic.
 *
 * In a real system the producer serialises the payload (JSON, Avro, Protobuf)
 * before sending it over the network. Here we skip serialisation.
 *
 * The optional `key` is used for partitioning — messages with the same key
 * always go to the same partition (guaranteed ordering per key).
 * In load-balancing consumer groups, routing is done by key hash % numConsumers.
 */
export class Producer {
  constructor(private readonly broker: InMemoryBroker) {}

  send<T = unknown>(topic: string, payload: T, key?: string): number {
    const message = this.broker.produce(topic, payload, key);
    return message.offset;
  }
}
