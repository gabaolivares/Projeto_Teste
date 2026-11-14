import { Money, type MoneyProps } from './money.js';
export declare enum WagerTransactionKind {
    Opening = "OPENING",
    Bet = "BET",
    Win = "WIN",
    Loss = "LOSS",
    Refund = "REFUND",
    Rollback = "ROLLBACK"
}
export declare enum WagerTransactionStatus {
    Pending = "PENDING",
    PendingReference = "PENDING_REFERENCE",
    Processed = "PROCESSED",
    Rejected = "REJECTED",
    Failed = "FAILED"
}
export type FailureCode = 'INVALID_WALLET' | 'WALLET_NOT_FOUND' | 'PLAYER_MISMATCH' | 'CURRENCY_MISMATCH' | 'INSUFFICIENT_FUNDS' | 'REVERSAL_WOULD_OVERDRAW' | 'REFERENCE_NOT_FOUND' | 'REFERENCE_MISMATCH' | 'REFERENCE_KIND_INVALID' | 'REFERENCE_AMOUNT_MISMATCH' | 'ALREADY_REVERSED';
export interface CreateWagerTransactionProps {
    readonly id: string;
    readonly providerId: string;
    readonly externalTransactionId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly walletId: string;
    readonly playerId: string;
    readonly roundId: string;
    readonly gameId: string;
    readonly kind: WagerTransactionKind;
    readonly money: Money;
    readonly referenceExternalTransactionId?: string;
    readonly createdAt?: Date;
}
export interface WagerTransactionState extends Omit<CreateWagerTransactionProps, 'money' | 'createdAt'> {
    readonly money: MoneyProps;
    readonly createdAt: Date;
    readonly status: WagerTransactionStatus;
    readonly referenceTransactionId?: string;
    readonly failureCode?: FailureCode;
    readonly processedAt?: Date;
}
export declare class InvalidTransactionStateError extends Error {
    constructor(status: WagerTransactionStatus);
}
export declare class WagerTransaction {
    readonly id: string;
    readonly providerId: string;
    readonly externalTransactionId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly walletId: string;
    readonly playerId: string;
    readonly roundId: string;
    readonly gameId: string;
    readonly kind: WagerTransactionKind;
    readonly money: Money;
    readonly referenceExternalTransactionId: string | undefined;
    private _status;
    private _referenceTransactionId?;
    private _failureCode?;
    private _processedAt?;
    private readonly _createdAt;
    private constructor();
    static create(props: CreateWagerTransactionProps): WagerTransaction;
    static rehydrate(state: WagerTransactionState): WagerTransaction;
    get status(): WagerTransactionStatus;
    get createdAt(): Date;
    get referenceTransactionId(): string | undefined;
    get failureCode(): FailureCode | undefined;
    get processedAt(): Date | undefined;
    isTerminal(): boolean;
    affectsBalance(): boolean;
    requiresReference(): boolean;
    matchesPayload(payloadHash: string): boolean;
    ledgerDirectionFor(reference?: WagerTransaction): 'DEBIT' | 'CREDIT' | undefined;
    markProcessed(referenceTransactionId: string | undefined, at: Date): void;
    markPendingReference(): void;
    reject(code: FailureCode): void;
    fail(code: FailureCode): void;
    private assertTransitionAllowed;
    private static copyValidDate;
}
