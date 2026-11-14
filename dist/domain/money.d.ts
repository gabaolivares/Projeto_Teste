export interface MoneyProps {
    readonly amount: string;
    readonly currency: string;
}
export declare class Money {
    #private;
    readonly currency: string;
    private static readonly isoCurrencyCodes;
    private constructor();
    static from(props: MoneyProps): Money;
    static zero(currency: string): Money;
    add(other: Money): Money;
    subtract(other: Money): Money;
    negate(): Money;
    isZero(): boolean;
    isPositive(): boolean;
    isNegative(): boolean;
    isLessThan(other: Money): boolean;
    equals(other: Money): boolean;
    toJSON(): MoneyProps;
    toString(): string;
    private assertSameCurrency;
    private static assertCurrency;
}
