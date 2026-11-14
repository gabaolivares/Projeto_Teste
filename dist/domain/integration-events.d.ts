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
export declare abstract class IntegrationEvent<T> {
    abstract readonly eventType: string;
    abstract readonly version: number;
    readonly eventId: string;
    readonly aggregateId: string;
    readonly correlationId: string;
    readonly causationId?: string;
    private readonly _occurredAt;
    readonly data: Readonly<T>;
    protected constructor(props: IntegrationEventProps<T>);
    get occurredAt(): Date;
    toJSON(): {
        eventId: string;
        eventType: string;
        aggregateId: string;
        correlationId: string;
        causationId?: string;
        occurredAt: string;
        version: number;
        data: T;
    };
    private deepFreeze;
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
export declare class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionEventData> {
    readonly eventType = "WagerTransactionProcessed";
    readonly version = 1;
    constructor(props: IntegrationEventProps<WagerTransactionEventData>);
}
export declare class WagerTransactionRejected extends IntegrationEvent<WagerTransactionEventData> {
    readonly eventType = "WagerTransactionRejected";
    readonly version = 1;
    constructor(props: IntegrationEventProps<WagerTransactionEventData>);
}
export declare class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionEventData> {
    readonly eventType = "WagerTransactionPendingReference";
    readonly version = 1;
    constructor(props: IntegrationEventProps<WagerTransactionEventData>);
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
export declare class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
    readonly eventType = "WalletBalanceChanged";
    readonly version = 1;
    constructor(props: IntegrationEventProps<WalletBalanceChangedData>);
}
