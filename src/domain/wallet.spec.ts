import { Money } from './money.js';
import { Wallet } from './wallet.js';

describe('Wallet', () => {
  it('increments version only when a movement changes the balance', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    expect(wallet.version).toBe(1);
    wallet.debit(Money.from({ amount: '25.00', currency: 'BRL' }));
    expect(wallet.balance.toString()).toBe('75.00');
    expect(wallet.version).toBe(2);
    wallet.credit(Money.zero('BRL'));
    expect(wallet.version).toBe(2);
  });

  it('does not mutate the wallet when a debit would make the balance negative', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const updatedAt = wallet.updatedAt;

    expect(() => wallet.debit(Money.from({ amount: '100.01', currency: 'BRL' }))).toThrow(
      /Insufficient/u,
    );
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(wallet.updatedAt).toEqual(updatedAt);
  });

  it('rejects a movement in another currency without changing state', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    expect(() => wallet.credit(Money.from({ amount: '1.00', currency: 'USD' }))).toThrow(
      /currencies must match/u,
    );
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('rehydrates state and returns defensive date copies', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: { amount: '10.00', currency: 'BRL' },
      version: 3,
      createdAt,
      updatedAt: createdAt,
    });

    wallet.updatedAt.setFullYear(2030);
    expect(wallet.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
