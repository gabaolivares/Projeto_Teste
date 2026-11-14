import { Money } from './money.js';
import {
  InvalidTransactionStateError,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction.js';

const hash = 'a'.repeat(64);

function createTransaction(kind = WagerTransactionKind.Bet) {
  return WagerTransaction.create({
    id: 'transaction-1',
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'key-1',
    payloadHash: hash,
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    ...(kind === WagerTransactionKind.Refund
      ? { referenceExternalTransactionId: 'bet-1' }
      : {}),
  });
}

describe('WagerTransaction', () => {
  it('starts pending and prevents opening transactions from external creation', () => {
    expect(createTransaction().status).toBe(WagerTransactionStatus.Pending);
    expect(() => createTransaction(WagerTransactionKind.Opening)).toThrow(/externally/u);
  });

  it('requires references for reversals', () => {
    expect(() => createTransaction(WagerTransactionKind.Refund)).not.toThrow();
    expect(
      () =>
        WagerTransaction.create({
          id: 'transaction-2',
          providerId: 'provider-a',
          externalTransactionId: 'external-2',
          idempotencyKey: 'key-2',
          payloadHash: hash,
          walletId: 'wallet-1',
          playerId: 'player-1',
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Rollback,
          money: Money.from({ amount: '25.00', currency: 'BRL' }),
        }),
    ).toThrow(/requires a reference/u);
  });

  it('treats processed transactions as terminal', () => {
    const transaction = createTransaction();
    transaction.markProcessed(undefined, new Date());

    expect(transaction.isTerminal()).toBe(true);
    expect(() => transaction.reject('INSUFFICIENT_FUNDS')).toThrow(
      InvalidTransactionStateError,
    );
  });
});
