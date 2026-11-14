import { Money } from './money.js';

describe('Money', () => {
  it('uses exact decimal arithmetic without numeric conversion', () => {
    const balance = Money.from({
      amount: '999999999999999999999999999.99',
      currency: 'BRL',
    });

    expect(
      balance.add(Money.from({ amount: '0.01', currency: 'BRL' })).toString(),
    ).toBe('1000000000000000000000000000.00');
    expect(Object.isFrozen(balance)).toBe(true);
  });

  it.each(['', '1', '1.0', '1.001', '-1.00', '1e2', 'NaN', 'Infinity', '1.00\n'])(
    'rejects invalid amount %j',
    (amount) => {
      expect(() => Money.from({ amount, currency: 'BRL' })).toThrow();
    },
  );

  it('normalizes leading zeros and keeps two decimal places', () => {
    expect(Money.from({ amount: '00025.00', currency: 'BRL' }).toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });
  });

  it('rejects arithmetic between different currencies', () => {
    const brl = Money.from({ amount: '1.00', currency: 'BRL' });
    const usd = Money.from({ amount: '1.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow(/currencies must match/u);
    expect(() => brl.isLessThan(usd)).toThrow(/currencies must match/u);
    expect(() => brl.equals(usd)).toThrow(/currencies must match/u);
  });

  it('rejects currency tokens that are not in the ISO-4217 registry', () => {
    expect(() => Money.from({ amount: '1.00', currency: 'ZZZ' })).toThrow(
      /ISO-4217/u,
    );
  });

  it('can represent signed arithmetic results without accepting signed input', () => {
    const result = Money.zero('BRL').subtract(
      Money.from({ amount: '2.50', currency: 'BRL' }),
    );

    expect(result.toString()).toBe('-2.50');
    expect(result.isNegative()).toBe(true);
    expect(() => Money.from({ amount: '-2.50', currency: 'BRL' })).toThrow();
  });
});
