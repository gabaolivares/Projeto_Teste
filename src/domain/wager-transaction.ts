import { Money, type MoneyProps } from './money.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export type FailureCode =
  | 'INVALID_WALLET'
  | 'WALLET_NOT_FOUND'
  | 'PLAYER_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'INSUFFICIENT_FUNDS'
  | 'REVERSAL_WOULD_OVERDRAW'
  | 'REFERENCE_NOT_FOUND'
  | 'REFERENCE_MISMATCH'
  | 'REFERENCE_KIND_INVALID'
  | 'REFERENCE_AMOUNT_MISMATCH'
  | 'ALREADY_REVERSED';

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

export interface WagerTransactionState
  extends Omit<CreateWagerTransactionProps, 'money' | 'createdAt'> {
  readonly money: MoneyProps;
  readonly createdAt: Date;
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId?: string;
  readonly failureCode?: FailureCode;
  readonly processedAt?: Date;
}

export class InvalidTransactionStateError extends Error {
  constructor(status: WagerTransactionStatus) {
    super(`Cannot transition a ${status} wager transaction`);
    this.name = 'InvalidTransactionStateError';
  }
}

export class WagerTransaction {
  private readonly _createdAt: Date;

  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {
    this._createdAt = WagerTransaction.copyValidDate(createdAt);
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    for (const [field, value] of Object.entries({
      id: props.id,
      providerId: props.providerId,
      externalTransactionId: props.externalTransactionId,
      idempotencyKey: props.idempotencyKey,
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: props.roundId,
      gameId: props.gameId,
    })) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Wager transaction ${field} is required`);
      }
    }

    if (!/^[a-f0-9]{64}$/u.test(props.payloadHash)) {
      throw new Error('Wager transaction payload hash must be a SHA-256 hex digest');
    }

    if (!Object.values(WagerTransactionKind).includes(props.kind)) {
      throw new Error('Wager transaction kind is invalid');
    }

    if (props.kind === WagerTransactionKind.Opening) {
      throw new Error('OPENING transactions cannot be submitted externally');
    }

    if (!(props.money instanceof Money) || !props.money.isPositive()) {
      throw new Error('Wager transaction amount must be positive');
    }

    if (
      [WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(props.kind) &&
      !props.referenceExternalTransactionId
    ) {
      throw new Error(`${props.kind} requires a reference transaction`);
    }
    if (
      [WagerTransactionKind.Bet, WagerTransactionKind.Loss].includes(props.kind) &&
      props.referenceExternalTransactionId
    ) {
      throw new Error(`${props.kind} cannot reference another transaction`);
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    const transaction = new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt ? this.copyValidDate(state.processedAt) : undefined,
    );
    return transaction;
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt ? new Date(this._processedAt.getTime()) : undefined;
  }

  isTerminal(): boolean {
    return [
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
      WagerTransactionStatus.Failed,
    ].includes(this._status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): 'DEBIT' | 'CREDIT' | undefined {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return 'DEBIT';
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return 'CREDIT';
      case WagerTransactionKind.Loss:
        return undefined;
      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new Error('ROLLBACK ledger direction requires its reference');
        }
        if (
          ![
            WagerTransactionKind.Bet,
            WagerTransactionKind.Win,
            WagerTransactionKind.Refund,
          ].includes(reference.kind)
        ) {
          throw new Error('ROLLBACK reference kind is invalid');
        }
        return reference.ledgerDirectionFor() === 'DEBIT' ? 'CREDIT' : 'DEBIT';
    }
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertTransitionAllowed();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = undefined;
    this._processedAt = WagerTransaction.copyValidDate(at);
  }

  markPendingReference(): void {
    this.assertTransitionAllowed();
    this._status = WagerTransactionStatus.PendingReference;
    this._referenceTransactionId = undefined;
    this._failureCode = undefined;
    this._processedAt = undefined;
  }

  reject(code: FailureCode): void {
    this.assertTransitionAllowed();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertTransitionAllowed();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  private assertTransitionAllowed(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status);
    }
  }

  private static copyValidDate(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('Wager transaction date must be valid');
    }
    return new Date(value.getTime());
  }
}
