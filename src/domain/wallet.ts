import { Money, type MoneyProps } from './money.js';

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: MoneyProps;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Wallet {
  private readonly _createdAt: Date;
  private _balance: Money;
  private _version: number;
  private _updatedAt: Date;

  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    balance: Money,
    version: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this._balance = balance;
    this._version = version;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
  }

  static open(props: {
    readonly id: string;
    readonly playerId: string;
    readonly initialBalance: Money;
  }): Wallet {
    this.assertIdentity(props.id, 'id');
    this.assertIdentity(props.playerId, 'playerId');

    if (!(props.initialBalance instanceof Money) || props.initialBalance.isNegative()) {
      throw new Error('Initial wallet balance must be a non-negative Money value');
    }

    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    this.assertIdentity(state.id, 'id');
    this.assertIdentity(state.playerId, 'playerId');

    if (!Number.isSafeInteger(state.version) || state.version < 1) {
      throw new Error('Wallet version must be a positive safe integer');
    }

    const balance = Money.from(state.balance);
    if (balance.currency !== state.currency) {
      throw new Error('Wallet currency must match its balance currency');
    }

    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      balance,
      state.version,
      this.copyValidDate(state.createdAt),
      this.copyValidDate(state.updatedAt),
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt.getTime());
  }

  debit(amount: Money, at: Date = new Date()): void {
    this.assertValidMovement(amount);

    const nextBalance = this._balance.subtract(amount);
    if (nextBalance.isNegative()) {
      throw new Error('Insufficient wallet balance');
    }

    this.updateBalance(nextBalance, at);
  }

  credit(amount: Money, at: Date = new Date()): void {
    this.assertValidMovement(amount);
    this.updateBalance(this._balance.add(amount), at);
  }

  private assertValidMovement(amount: Money): void {
    if (!(amount instanceof Money) || amount.isNegative()) {
      throw new Error('Wallet movement must be a non-negative Money value');
    }

    if (amount.currency !== this.currency) {
      throw new Error('Wallet and movement currencies must match');
    }
  }

  private updateBalance(nextBalance: Money, at: Date): void {
    if (nextBalance.equals(this._balance)) {
      return;
    }

    if (this._version === Number.MAX_SAFE_INTEGER) {
      throw new Error('Wallet version cannot be incremented safely');
    }

    const updatedAt = Wallet.copyValidDate(at);
    this._balance = nextBalance;
    this._version += 1;
    this._updatedAt = updatedAt;
  }

  private static assertIdentity(value: string, field: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Wallet ${field} is required`);
    }
  }

  private static copyValidDate(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('Wallet timestamps must be valid dates');
    }

    return new Date(value.getTime());
  }
}
