import { Money } from './money.js';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface CreateLedgerEntryProps {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt?: Date;
}

export interface LedgerEntryState extends Omit<CreateLedgerEntryProps, 'createdAt'> {
  readonly createdAt: Date;
}

export class WalletLedgerEntry {
  private readonly _createdAt: Date;

  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    createdAt: Date,
  ) {
    this._createdAt = this.copyValidDate(createdAt);
    Object.freeze(this);
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!['DEBIT', 'CREDIT'].includes(props.direction)) {
      throw new Error('Ledger direction is invalid');
    }
    if (!(props.money instanceof Money) || !props.money.isPositive()) {
      throw new Error('Ledger amount must be positive');
    }

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date(),
    );

    if (!entry.isBalanced()) {
      throw new Error('Ledger entry balance arithmetic is invalid');
    }
    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  isBalanced(): boolean {
    if (
      this.money.currency !== this.balanceBefore.currency ||
      this.money.currency !== this.balanceAfter.currency
    ) {
      return false;
    }

    const expected =
      this.direction === 'DEBIT'
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);

    return !this.balanceAfter.isNegative() && expected.equals(this.balanceAfter);
  }

  private copyValidDate(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('Ledger entry date must be valid');
    }
    return new Date(value.getTime());
  }
}
