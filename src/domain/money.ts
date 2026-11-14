export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

export class Money {
  readonly #minorUnits: bigint;
  private static readonly isoCurrencyCodes = new Set(
    Intl.supportedValuesOf('currency'),
  );

  private constructor(minorUnits: bigint, public readonly currency: string) {
    this.#minorUnits = minorUnits;
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    if (typeof props !== 'object' || props === null) {
      throw new Error('Money properties are required');
    }

    const { amount, currency } = props;
    this.assertCurrency(currency);

    if (typeof amount !== 'string') {
      throw new Error('Money amount must be a decimal string');
    }

    const match = /^(\d+)\.(\d{2})$/u.exec(amount);
    if (match === null || match[0] !== amount) {
      throw new Error('Money amount must be a non-negative decimal with exactly 2 decimal places');
    }

    return new Money(BigInt(`${match[1]}${match[2]}`), currency);
  }

  static zero(currency: string): Money {
    this.assertCurrency(currency);
    return new Money(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.#minorUnits + other.#minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.#minorUnits - other.#minorUnits, this.currency);
  }

  negate(): Money {
    return new Money(-this.#minorUnits, this.currency);
  }

  isZero(): boolean {
    return this.#minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.#minorUnits > 0n;
  }

  isNegative(): boolean {
    return this.#minorUnits < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.#minorUnits < other.#minorUnits;
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.#minorUnits === other.#minorUnits;
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    const isNegative = this.#minorUnits < 0n;
    const digits = (isNegative ? -this.#minorUnits : this.#minorUnits)
      .toString()
      .padStart(3, '0');

    return `${isNegative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
  }

  private assertSameCurrency(other: Money): void {
    if (!(other instanceof Money) || this.currency !== other.currency) {
      throw new Error('Money currencies must match');
    }
  }

  private static assertCurrency(currency: string): void {
    if (
      typeof currency !== 'string' ||
      currency.length !== 3 ||
      !/^[A-Z]{3}$/u.test(currency) ||
      !this.isoCurrencyCodes.has(currency)
    ) {
      throw new Error('Currency must be an uppercase ISO-4217 code');
    }
  }
}
