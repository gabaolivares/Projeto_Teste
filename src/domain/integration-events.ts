import type { LedgerDirection } from './wallet-ledger-entry.js';
import type { MoneyProps } from './money.js';
import type { WagerTransactionKind } from './wager-transaction.js';

export interface EventContext {
  readonly correlationId: string;
  readonly causationId?: string;
}

export interface IntegrationEventProps<T> {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: T;
}

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  private readonly _occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this._occurredAt = new Date(props.occurredAt.getTime());
    this.data = this.deepFreeze({ ...props.data });
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  toJSON(): {
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: string;
    version: number;
    data: T;
  } {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId ? { causationId: this.causationId } : {}),
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data as T,
    };
  }

  private deepFreeze<Value>(value: Value): Readonly<Value> {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach((item) => this.deepFreeze(item));
      Object.freeze(value);
    }
    return value;
  }
}

export interface WagerTransactionEventData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly kind: WagerTransactionKind;
  readonly status: string;
  readonly money?: MoneyProps;
  readonly failureCode?: string;
  readonly balance?: MoneyProps;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionEventData>) {
    super(props);
    Object.freeze(this);
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionEventData>) {
    super(props);
    Object.freeze(this);
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionEventData>) {
    super(props);
    Object.freeze(this);
  }
}

export interface WalletBalanceChangedData {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
    Object.freeze(this);
  }
}
