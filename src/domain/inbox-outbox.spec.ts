import { InboxMessage } from './inbox-message.js';
import { OutboxMessage } from './outbox-message.js';
import { WagerTransactionProcessed } from './integration-events.js';
import { WagerTransactionKind } from './wager-transaction.js';

describe('InboxMessage', () => {
  it('marks a received message processed idempotently', () => {
    const inbox = InboxMessage.receive({
      messageId: 'message-1',
      consumerName: 'consumer-1',
      payloadHash: 'a'.repeat(64),
    });

    expect(inbox.isProcessed()).toBe(false);
    inbox.markProcessed(new Date('2026-01-01T00:00:00.000Z'));
    inbox.markProcessed(new Date('2026-01-02T00:00:00.000Z'));
    expect(inbox.isProcessed()).toBe(true);
    expect(inbox.processedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('OutboxMessage', () => {
  it('schedules retry with backoff and reaches published state', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const outbox = OutboxMessage.enqueue(
      new WagerTransactionProcessed({
        eventId: 'event-1',
        aggregateId: 'wallet-1',
        correlationId: 'correlation-1',
        occurredAt: now,
        data: {
          transactionId: 'transaction-1',
          providerId: 'provider-1',
          externalTransactionId: 'external-1',
          walletId: 'wallet-1',
          kind: WagerTransactionKind.Bet,
          status: 'PROCESSED',
        },
      }),
    );

    outbox.scheduleRetry(now);
    expect(outbox.attempts).toBe(1);
    expect(outbox.nextAttemptAt?.toISOString()).toBe('2026-01-01T00:00:02.000Z');
    expect(outbox.isDue(new Date('2026-01-01T00:00:02.000Z'))).toBe(true);
    outbox.markPublished(new Date('2026-01-01T00:00:03.000Z'));
    expect(outbox.isPending()).toBe(false);
    expect(() => outbox.scheduleRetry(now)).toThrow(/cannot be retried/u);
  });
});
