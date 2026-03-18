import { EventStore } from '../shared/EventStore';
import { EventBus } from '../shared/EventBus';
import { BankAccount } from '../01-event-sourcing/BankAccount';
import { CommandBus } from './CommandBus';

// ── Commands ──────────────────────────────────────────────────────────────────

export interface OpenAccountCommand {
  readonly type: 'OpenAccount';
  readonly accountId: string;
  readonly owner: string;
  readonly initialBalance: number;
}

export interface DepositCommand {
  readonly type: 'Deposit';
  readonly accountId: string;
  readonly amount: number;
}

export interface WithdrawCommand {
  readonly type: 'Withdraw';
  readonly accountId: string;
  readonly amount: number;
}

/**
 * Write model: processes commands by loading the aggregate, executing business
 * logic, and persisting the resulting events.
 *
 * After persisting, it publishes each new event to the EventBus so that
 * projections (read models) can update themselves synchronously.
 *
 * This is the "C" in CQRS — all mutations flow through here.
 */
export class WriteModel {
  constructor(
    private readonly store: EventStore,
    private readonly bus: EventBus
  ) {}

  registerHandlers(commandBus: CommandBus): void {
    commandBus.register<OpenAccountCommand>('OpenAccount', (cmd) => {
      const account = new BankAccount(cmd.accountId, this.store);
      account.open(cmd.owner, cmd.initialBalance);
      this.publishNewEvents(cmd.accountId, 0);
    });

    commandBus.register<DepositCommand>('Deposit', (cmd) => {
      const account = new BankAccount(cmd.accountId, this.store);
      account.rehydrate();
      const versionBefore = account.getVersion();
      account.deposit(cmd.amount);
      this.publishNewEvents(cmd.accountId, versionBefore);
    });

    commandBus.register<WithdrawCommand>('Withdraw', (cmd) => {
      const account = new BankAccount(cmd.accountId, this.store);
      account.rehydrate();
      const versionBefore = account.getVersion();
      account.withdraw(cmd.amount);
      this.publishNewEvents(cmd.accountId, versionBefore);
    });
  }

  private publishNewEvents(aggregateId: string, fromVersion: number): void {
    const newEvents = this.store
      .getEvents(aggregateId)
      .filter((e) => e.version > fromVersion);

    for (const event of newEvents) {
      this.bus.publish(event.type, event);
    }
  }
}
