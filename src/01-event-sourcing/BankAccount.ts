import { DomainEvent, EventStore } from '../shared/EventStore';
import { EventSourcedAggregate } from './EventSourcedAggregate';

interface BankAccountState {
  balance: number;
  owner: string;
  isOpen: boolean;
}

// ── Domain events ─────────────────────────────────────────────────────────────
// Each event is a named fact in the past tense.
// Payload carries only what changed — nothing derived.

export type AccountOpenedPayload = { owner: string; initialBalance: number };
export type MoneyDepositedPayload = { amount: number };
export type MoneyWithdrawnPayload = { amount: number };
export type AccountClosedPayload = Record<string, never>;

// ── Aggregate ─────────────────────────────────────────────────────────────────

export class BankAccount extends EventSourcedAggregate<BankAccountState> {
  constructor(id: string, store: EventStore) {
    super(id, store);
    this.state = this.initialState();
  }

  protected initialState(): BankAccountState {
    return { balance: 0, owner: '', isOpen: false };
  }

  // ── Commands ────────────────────────────────────────────────────────────────
  // Commands validate business rules BEFORE raising events.
  // Once an event is raised it is immutable — validation cannot happen after.

  open(owner: string, initialBalance: number): void {
    if (this.state.isOpen) throw new Error('Account is already open');
    if (initialBalance < 0) throw new Error('Initial balance cannot be negative');
    this.raise('AccountOpened', { owner, initialBalance });
  }

  deposit(amount: number): void {
    if (!this.state.isOpen) throw new Error('Account is closed');
    if (amount <= 0) throw new Error('Deposit amount must be positive');
    this.raise('MoneyDeposited', { amount });
  }

  withdraw(amount: number): void {
    if (!this.state.isOpen) throw new Error('Account is closed');
    if (amount <= 0) throw new Error('Withdrawal amount must be positive');
    if (amount > this.state.balance) throw new Error('Insufficient funds');
    this.raise('MoneyWithdrawn', { amount });
  }

  close(): void {
    if (!this.state.isOpen) throw new Error('Account is already closed');
    this.raise('AccountClosed', {});
  }

  // ── Queries (pure reads — never mutate state) ────────────────────────────────

  get balance(): number {
    return this.state.balance;
  }

  get owner(): string {
    return this.state.owner;
  }

  get isOpen(): boolean {
    return this.state.isOpen;
  }

  // ── Event application ────────────────────────────────────────────────────────
  // apply() is the ONLY place where state changes.
  // It is a pure reducer: (state, event) → state.

  protected apply(event: DomainEvent): void {
    switch (event.type) {
      case 'AccountOpened': {
        const p = event.payload as AccountOpenedPayload;
        this.state.owner = p.owner;
        this.state.balance = p.initialBalance;
        this.state.isOpen = true;
        break;
      }
      case 'MoneyDeposited': {
        const p = event.payload as MoneyDepositedPayload;
        this.state.balance += p.amount;
        break;
      }
      case 'MoneyWithdrawn': {
        const p = event.payload as MoneyWithdrawnPayload;
        this.state.balance -= p.amount;
        break;
      }
      case 'AccountClosed': {
        this.state.isOpen = false;
        break;
      }
    }
  }
}
