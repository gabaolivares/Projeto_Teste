import { Money } from './money.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';

describe('WalletLedgerEntry', () => {
  it('validates debit arithmetic at creation', () => {
    const entry = WalletLedgerEntry.create({
      id: 'entry-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: 'DEBIT',
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '20.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '10.00', currency: 'BRL' }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('rejects an unbalanced ledger entry', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: 'DEBIT',
        money: Money.from({ amount: '10.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '20.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '11.00', currency: 'BRL' }),
      }),
    ).toThrow(/arithmetic/u);
  });

  it('does not expose its mutable timestamp', () => {
    const entry = WalletLedgerEntry.create({
      id: 'entry-2',
      walletId: 'wallet-1',
      transactionId: 'transaction-2',
      direction: 'CREDIT',
      money: Money.from({ amount: '1.00', currency: 'BRL' }),
      balanceBefore: Money.zero('BRL'),
      balanceAfter: Money.from({ amount: '1.00', currency: 'BRL' }),
    });
    const exposedDate = entry.createdAt;
    exposedDate.setFullYear(2000);

    expect(entry.createdAt.getFullYear()).not.toBe(2000);
  });
});
