import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { Money, type MoneyProps } from '../../domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type FailureCode,
} from '../../domain/wager-transaction.js';
import {
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '../../domain/integration-events.js';
import { InboxMessage } from '../../domain/inbox-message.js';
import { OutboxMessage } from '../../domain/outbox-message.js';
import {
  WalletLedgerEntry,
  type LedgerDirection,
} from '../../domain/wallet-ledger-entry.js';
import { Wallet } from '../../domain/wallet.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';

export interface SubmitWagerInput {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: string;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
}

export interface ProcessContext {
  readonly correlationId: string;
  readonly messageId?: string;
  readonly consumerName?: string;
  readonly inboxPayloadHash?: string;
}

export interface WagerResult {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance?: MoneyProps;
  readonly failureCode?: string;
  readonly idempotentReplay: boolean;
}

interface WalletRow {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface TransactionRow {
  id: string;
  provider_id: string;
  external_transaction_id: string;
  idempotency_key: string;
  payload_hash: string;
  wallet_id: string;
  player_id: string;
  round_id: string;
  game_id: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  reference_external_transaction_id: string | null;
  reference_transaction_id: string | null;
  status: WagerTransactionStatus;
  failure_code: string | null;
  created_at: Date;
  processed_at: Date | null;
  pending_attempts: number;
  next_attempt_at: Date | null;
  result_balance: string | null;
  result_balance_currency: string | null;
}

interface ResolvedReference {
  id: string;
  provider_id: string;
  player_id: string;
  wallet_id: string;
  round_id: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  status: WagerTransactionStatus;
  direction: LedgerDirection | null;
}

export interface WalletSummary {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
}

const MAX_REFERENCE_RETRIES = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class WageringService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  async openWallet(input: {
    readonly playerId: string;
    readonly initialBalance: MoneyProps;
  }): Promise<WalletSummary> {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Wallet body is required');
    }
    if (typeof input.playerId !== 'string' || input.playerId.trim().length === 0) {
      throw new BadRequestException('playerId is required');
    }

    const initialBalance = this.parseMoney(input.initialBalance);
    const id = randomUUID();
    const wallet = Wallet.open({ id, playerId: input.playerId, initialBalance });
    const now = wallet.createdAt;

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 1, $5, $5)`,
          [wallet.id, wallet.playerId, wallet.currency, wallet.balance.toString(), now],
        );

        if (initialBalance.isPositive()) {
          await this.persistOpeningTransaction(manager, wallet, initialBalance, now);
        }
      });
    } catch (error) {
      if (this.isPostgresError(error, '23505')) {
        throw new ConflictException('A wallet already exists for this player and currency');
      }
      throw error;
    }

    this.logger.info('wallet.opened', { walletId: wallet.id });
    return this.walletSummary(wallet);
  }

  async getWallet(walletId: string): Promise<WalletSummary> {
    this.assertUuid(walletId, 'walletId');
    const rows = (await this.dataSource.query(
      'SELECT id, player_id, currency, balance::text, version, created_at, updated_at FROM wallets WHERE id = $1',
      [walletId],
    )) as WalletRow[];
    if (!rows[0]) {
      throw new NotFoundException('Wallet was not found');
    }
    return this.walletSummary(this.toWallet(rows[0]));
  }

  async submit(
    input: SubmitWagerInput,
    idempotencyKey: string,
    context: ProcessContext,
  ): Promise<WagerResult> {
    const parsed = this.parseWager(input, idempotencyKey);
    const payloadHash = this.hashBusinessPayload(parsed);
    const transaction = WagerTransaction.create({
      id: randomUUID(),
      ...parsed,
      payloadHash,
    });
    const inboxMessage =
      context.messageId && context.consumerName
        ? InboxMessage.receive({
            messageId: context.messageId,
            consumerName: context.consumerName,
            payloadHash: context.inboxPayloadHash ?? payloadHash,
          })
        : undefined;
    const startedAt = performance.now();

    const result = await this.dataSource.transaction(async (manager) => {
      if (context.messageId && context.consumerName) {
        if (!inboxMessage) {
          throw new Error('Inbox domain state is required for SQS processing');
        }
        const inboxInserted = (await manager.query(
          `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (consumer_name, message_id) DO NOTHING
           RETURNING message_id`,
          [
            context.consumerName,
            context.messageId,
            inboxMessage.payloadHash,
            inboxMessage.receivedAt,
          ],
        )) as Array<{ message_id: string }>;

        if (!inboxInserted[0]) {
          const inbox = (await manager.query(
            `SELECT payload_hash, processed_at
             FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2`,
            [context.consumerName, context.messageId],
          )) as Array<{ payload_hash: string; processed_at: Date | null }>;
          if (inbox[0]?.payload_hash !== inboxMessage.payloadHash) {
            throw new ConflictException('SQS messageId was reused with a different payload');
          }
          const existing = await this.findByIdempotency(
            manager,
            parsed.providerId,
            parsed.idempotencyKey,
          );
          if (existing) {
            await this.markInboxProcessed(manager, context, inboxMessage);
            return this.resultFromRow(existing, true);
          }
          if (inbox[0]?.processed_at) {
            throw new Error('Processed inbox message has no corresponding transaction');
          }
        }
      }

      const inserted = (await manager.query(
        `INSERT INTO wager_transactions (
           id, provider_id, external_transaction_id, idempotency_key, payload_hash,
           wallet_id, player_id, round_id, game_id, kind, amount, currency,
           reference_external_transaction_id, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDING')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          transaction.id,
          transaction.providerId,
          transaction.externalTransactionId,
          transaction.idempotencyKey,
          transaction.payloadHash,
          transaction.walletId,
          transaction.playerId,
          transaction.roundId,
          transaction.gameId,
          transaction.kind,
          transaction.money.toString(),
          transaction.money.currency,
          transaction.referenceExternalTransactionId ?? null,
        ],
      )) as Array<{ id: string }>;

      if (!inserted[0]) {
        const existing = await this.findByIdempotency(
          manager,
          transaction.providerId,
          transaction.idempotencyKey,
        );
        if (existing) {
          if (!transaction.matchesPayload(existing.payload_hash)) {
            throw new ConflictException('Idempotency-Key was already used with a different payload');
          }
          if (context.messageId && context.consumerName) {
            await this.markInboxProcessed(manager, context, inboxMessage);
          }
          return this.resultFromRow(existing, true);
        }

        const externalConflict = (await manager.query(
          `SELECT id FROM wager_transactions
           WHERE provider_id = $1 AND external_transaction_id = $2`,
          [transaction.providerId, transaction.externalTransactionId],
        )) as Array<{ id: string }>;
        if (externalConflict[0]) {
          throw new ConflictException('Provider transaction ID was already used with another idempotency key');
        }
        throw new Error('Transaction insert conflicted without a matching idempotency record');
      }

      const result = await this.applyTransaction(
        manager,
        transaction,
        context,
        0,
        true,
      );
      if (context.messageId && context.consumerName) {
        await this.markInboxProcessed(manager, context, inboxMessage);
      }
      return result;
    });

    this.metrics.transactionStatus(result.status);
    if (result.idempotentReplay) {
      this.metrics.increment('duplicates');
    }
    this.metrics.observeProcessingLatency(performance.now() - startedAt);
    this.logger.info('wagering.transaction_completed', {
      correlationId: context.correlationId,
      messageId: context.messageId,
      transactionId: result.transactionId,
      walletId: parsed.walletId,
      providerId: parsed.providerId,
      errorCode: result.failureCode,
    });
    return result;
  }

  async findTransaction(transactionId: string): Promise<WagerResult> {
    this.assertUuid(transactionId, 'transactionId');
    const rows = (await this.dataSource.query(
      `SELECT id, status, failure_code, result_balance, result_balance_currency
       FROM wager_transactions WHERE id = $1`,
      [transactionId],
    )) as Array<{
      id: string;
      status: WagerTransactionStatus;
      failure_code: string | null;
      result_balance: string | null;
      result_balance_currency: string | null;
    }>;
    if (!rows[0]) {
      throw new NotFoundException('Wager transaction was not found');
    }
    return {
      transactionId: rows[0].id,
      status: rows[0].status,
      ...(rows[0].result_balance !== null && rows[0].result_balance_currency
        ? {
            balance: {
              amount: this.canonicalAmount(rows[0].result_balance),
              currency: rows[0].result_balance_currency.trim(),
            },
          }
        : {}),
      ...(rows[0].failure_code ? { failureCode: rows[0].failure_code } : {}),
      idempotentReplay: true,
    };
  }

  async findProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerResult> {
    const rows = (await this.dataSource.query(
      `SELECT id, status, failure_code, result_balance, result_balance_currency
       FROM wager_transactions
       WHERE provider_id = $1 AND external_transaction_id = $2`,
      [providerId, externalTransactionId],
    )) as Array<{
      id: string;
      status: WagerTransactionStatus;
      failure_code: string | null;
      result_balance: string | null;
      result_balance_currency: string | null;
    }>;
    if (!rows[0]) {
      throw new NotFoundException('Provider transaction was not found');
    }
    return {
      transactionId: rows[0].id,
      status: rows[0].status,
      ...(rows[0].result_balance !== null && rows[0].result_balance_currency
        ? {
            balance: {
              amount: this.canonicalAmount(rows[0].result_balance),
              currency: rows[0].result_balance_currency.trim(),
            },
          }
        : {}),
      ...(rows[0].failure_code ? { failureCode: rows[0].failure_code } : {}),
      idempotentReplay: true,
    };
  }

  async listLedger(
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ entries: Array<Record<string, unknown>>; nextCursor?: string }> {
    this.assertUuid(walletId, 'walletId');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100');
    }
    const walletExists = (await this.dataSource.query(
      'SELECT id FROM wallets WHERE id = $1',
      [walletId],
    )) as Array<{ id: string }>;
    if (!walletExists[0]) {
      throw new NotFoundException('Wallet was not found');
    }
    const cursorValue = cursor ? this.decodeCursor(cursor) : undefined;
    const query = cursorValue
      ? `SELECT id, transaction_id, direction, amount::text, currency, balance_before::text,
                balance_after::text, created_at
         FROM wallet_ledger_entries
         WHERE wallet_id = $1 AND (created_at, id) < ($2::timestamptz, $3::uuid)
         ORDER BY created_at DESC, id DESC LIMIT $4`
      : `SELECT id, transaction_id, direction, amount::text, currency, balance_before::text,
                balance_after::text, created_at
         FROM wallet_ledger_entries
         WHERE wallet_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2`;
    const params = cursorValue
      ? [walletId, cursorValue.createdAt, cursorValue.id, limit + 1]
      : [walletId, limit + 1];
    const rows = (await this.dataSource.query(query, params)) as Array<{
      id: string;
      transaction_id: string;
      direction: LedgerDirection;
      amount: string;
      currency: string;
      balance_before: string;
      balance_after: string;
      created_at: Date;
    }>;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const entries = page.map((row) => ({
      id: row.id,
      transactionId: row.transaction_id,
      direction: row.direction,
      money: { amount: this.canonicalAmount(row.amount), currency: row.currency.trim() },
      balanceBefore: {
        amount: this.canonicalAmount(row.balance_before),
        currency: row.currency.trim(),
      },
      balanceAfter: {
        amount: this.canonicalAmount(row.balance_after),
        currency: row.currency.trim(),
      },
      createdAt: new Date(row.created_at).toISOString(),
    }));

    return {
      entries,
      ...(hasMore && page.length
        ? {
            nextCursor: this.encodeCursor(
              page[page.length - 1]!.created_at,
              page[page.length - 1]!.id,
            ),
          }
        : {}),
    };
  }

  async reconcile(walletId: string): Promise<{
    walletId: string;
    storedBalance: MoneyProps;
    calculatedBalance: MoneyProps;
    difference: MoneyProps;
    consistent: boolean;
    checkedEntries: number;
  }> {
    this.assertUuid(walletId, 'walletId');
    const rows = (await this.dataSource.query(
      `SELECT w.id, w.balance::text, w.currency,
              COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END), 0)::text
                AS calculated_balance,
              COUNT(l.id)::int AS checked_entries
       FROM wallets w
       LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
       WHERE w.id = $1
       GROUP BY w.id`,
      [walletId],
    )) as Array<{
      id: string;
      balance: string;
      currency: string;
      calculated_balance: string;
      checked_entries: number;
    }>;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Wallet was not found');
    }
    const currency = row.currency.trim();
    const stored = Money.from({ amount: this.canonicalAmount(row.balance), currency });
    const calculated = Money.from({
      amount: this.canonicalAmount(row.calculated_balance),
      currency,
    });
    const difference = stored.subtract(calculated);
    const consistent = difference.isZero();
    if (!consistent) {
      this.metrics.increment('reconciliation_mismatches');
      this.logger.error('wallet.reconciliation_mismatch', { walletId });
    }
    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: row.checked_entries,
    };
  }

  async processPendingReferences(): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT id FROM wager_transactions
       WHERE status = 'PENDING_REFERENCE' AND next_attempt_at <= now()
       ORDER BY next_attempt_at, created_at
       LIMIT 20`,
    )) as Array<{ id: string }>;

    for (const row of rows) {
      await this.dataSource.transaction(async (manager) => {
        const claimed = (await manager.query(
          `SELECT * FROM wager_transactions
           WHERE id = $1 AND status = 'PENDING_REFERENCE' AND next_attempt_at <= now()
           FOR UPDATE SKIP LOCKED`,
          [row.id],
        )) as TransactionRow[];
        if (!claimed[0]) {
          return;
        }
        const transaction = this.toDomain(claimed[0]);
        const context = { correlationId: transaction.id };
        await this.applyTransaction(
          manager,
          transaction,
          context,
          claimed[0].pending_attempts,
          false,
        );
      });
    }
  }

  async getOutboxLagSeconds(): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(occurred_at))), 0)::text AS lag
       FROM outbox_messages WHERE published_at IS NULL`,
    )) as Array<{ lag: string }>;
    return Number(rows[0]?.lag ?? 0);
  }

  private async applyTransaction(
    manager: EntityManager,
    transaction: WagerTransaction,
    context: ProcessContext,
    pendingAttempts: number,
    emitPendingEvent: boolean,
  ): Promise<WagerResult> {
    const waitStartedAt = performance.now();
    const walletRows = (await manager.query(
      `SELECT id, player_id, currency, balance::text, version, created_at, updated_at
       FROM wallets WHERE id = $1 FOR UPDATE`,
      [transaction.walletId],
    )) as WalletRow[];
    const waitDuration = performance.now() - waitStartedAt;
    if (waitDuration > 100) {
      this.metrics.increment('lock_conflicts');
    }

    const walletRow = walletRows[0];
    if (!walletRow) {
      return this.rejectTransaction(
        manager,
        transaction,
        'WALLET_NOT_FOUND',
        undefined,
        context,
      );
    }

    const wallet = this.toWallet(walletRow);
    if (wallet.playerId !== transaction.playerId) {
      return this.rejectTransaction(
        manager,
        transaction,
        'PLAYER_MISMATCH',
        wallet.balance,
        context,
      );
    }
    if (wallet.currency !== transaction.money.currency) {
      return this.rejectTransaction(
        manager,
        transaction,
        'CURRENCY_MISMATCH',
        wallet.balance,
        context,
      );
    }

    let reference: ResolvedReference | undefined;
    if (transaction.referenceExternalTransactionId) {
      const references = (await manager.query(
        `SELECT id, provider_id, player_id, wallet_id, round_id, kind, amount::text,
                currency, status, CASE
                  WHEN kind IN ('BET') THEN 'DEBIT'
                  WHEN kind IN ('WIN', 'REFUND', 'OPENING') THEN 'CREDIT'
                  ELSE NULL
                END AS direction
         FROM wager_transactions
         WHERE provider_id = $1 AND external_transaction_id = $2
         FOR UPDATE`,
        [transaction.providerId, transaction.referenceExternalTransactionId],
      )) as ResolvedReference[];
      reference = references[0];

      if (!reference || this.isReferenceWaiting(reference)) {
        if (!emitPendingEvent && pendingAttempts + 1 >= MAX_REFERENCE_RETRIES) {
          return this.rejectTransaction(
            manager,
            transaction,
            'REFERENCE_NOT_FOUND',
            wallet.balance,
            context,
          );
        }
        return this.deferTransaction(
          manager,
          transaction,
          wallet.balance,
          emitPendingEvent ? 0 : pendingAttempts + 1,
          context,
          emitPendingEvent,
        );
      }

      const referenceFailure = this.validateReference(transaction, wallet, reference);
      if (referenceFailure) {
        return this.rejectTransaction(
          manager,
          transaction,
          referenceFailure,
          wallet.balance,
          context,
        );
      }
    } else if (transaction.requiresReference()) {
      return this.deferTransaction(
        manager,
        transaction,
        wallet.balance,
        emitPendingEvent ? 0 : pendingAttempts + 1,
        context,
        emitPendingEvent,
      );
    }

    const direction =
      transaction.kind === WagerTransactionKind.Rollback
        ? reference?.direction === 'DEBIT'
          ? 'CREDIT'
          : reference?.direction === 'CREDIT'
            ? 'DEBIT'
            : undefined
        : transaction.ledgerDirectionFor();

    if (
      direction &&
      [WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(transaction.kind)
    ) {
      const reversed = (await manager.query(
        `SELECT id FROM wager_transactions
         WHERE reference_transaction_id = $1 AND kind = $2 AND status = 'PROCESSED'`,
        [reference?.id, transaction.kind],
      )) as Array<{ id: string }>;
      if (reversed[0]) {
        return this.rejectTransaction(
          manager,
          transaction,
          'ALREADY_REVERSED',
          wallet.balance,
          context,
        );
      }
    }

    let before: Money | undefined;
    let after: Money | undefined;
    let entry: WalletLedgerEntry | undefined;
    if (direction === 'DEBIT') {
      before = wallet.balance;
      try {
        wallet.debit(transaction.money);
      } catch {
        const failureCode =
          transaction.kind === WagerTransactionKind.Rollback ||
          transaction.kind === WagerTransactionKind.Refund
            ? 'REVERSAL_WOULD_OVERDRAW'
            : 'INSUFFICIENT_FUNDS';
        return this.rejectTransaction(
          manager,
          transaction,
          failureCode,
          wallet.balance,
          context,
        );
      }
      after = wallet.balance;
    } else if (direction === 'CREDIT') {
      before = wallet.balance;
      wallet.credit(transaction.money);
      after = wallet.balance;
    }

    const processedAt = new Date();
    transaction.markProcessed(reference?.id, processedAt);

    if (direction && before && after && !before.equals(after)) {
      entry = WalletLedgerEntry.create({
        id: randomUUID(),
        walletId: wallet.id,
        transactionId: transaction.id,
        direction,
        money: transaction.money,
        balanceBefore: before,
        balanceAfter: after,
        createdAt: processedAt,
      });

      const update = (await manager.query(
        `UPDATE wallets SET balance = $1, version = $2, updated_at = $3
         WHERE id = $4 AND version = $5
         RETURNING id`,
        [
          wallet.balance.toString(),
          wallet.version,
          wallet.updatedAt,
          wallet.id,
          wallet.version - 1,
        ],
      )) as Array<{ id: string }>;
      if (!update[0]) {
        throw new Error('Wallet optimistic version check failed');
      }
      await this.insertLedger(manager, entry);
      await this.enqueueEvent(
        manager,
        new WalletBalanceChanged({
          eventId: randomUUID(),
          aggregateId: wallet.id,
          correlationId: context.correlationId,
          causationId: transaction.id,
          occurredAt: processedAt,
          data: {
            walletId: wallet.id,
            transactionId: transaction.id,
            direction,
            money: transaction.money.toJSON(),
            balanceBefore: before.toJSON(),
            balanceAfter: after.toJSON(),
            walletVersion: wallet.version,
          },
        }),
      );
    }

    await manager.query(
      `UPDATE wager_transactions
       SET status = 'PROCESSED', reference_transaction_id = $1, failure_code = NULL,
           processed_at = $2, result_balance = $3, result_balance_currency = $4,
           pending_attempts = 0, next_attempt_at = NULL
       WHERE id = $5`,
      [
        reference?.id ?? null,
        processedAt,
        wallet.balance.toString(),
        wallet.currency,
        transaction.id,
      ],
    );
    await this.enqueueEvent(
      manager,
      new WagerTransactionProcessed({
        eventId: randomUUID(),
        aggregateId: wallet.id,
        correlationId: context.correlationId,
        causationId: transaction.id,
        occurredAt: processedAt,
        data: {
          transactionId: transaction.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          walletId: transaction.walletId,
          kind: transaction.kind,
          status: transaction.status,
          money: transaction.money.toJSON(),
          balance: wallet.balance.toJSON(),
        },
      }),
    );

    return {
      transactionId: transaction.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async rejectTransaction(
    manager: EntityManager,
    transaction: WagerTransaction,
    code: FailureCode,
    balance: Money | undefined,
    context: ProcessContext,
  ): Promise<WagerResult> {
    transaction.reject(code);
    const now = new Date();
    await manager.query(
      `UPDATE wager_transactions
       SET status = 'REJECTED', failure_code = $1, processed_at = $2,
           result_balance = $3, result_balance_currency = $4,
           next_attempt_at = NULL
       WHERE id = $5`,
      [
        code,
        now,
        balance?.toString() ?? null,
        balance?.currency ?? null,
        transaction.id,
      ],
    );
    await this.enqueueEvent(
      manager,
      new WagerTransactionRejected({
        eventId: randomUUID(),
        aggregateId: transaction.walletId,
        correlationId: context.correlationId,
        causationId: transaction.id,
        occurredAt: now,
        data: {
          transactionId: transaction.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          walletId: transaction.walletId,
          kind: transaction.kind,
          status: WagerTransactionStatus.Rejected,
          failureCode: code,
          money: transaction.money.toJSON(),
          ...(balance ? { balance: balance.toJSON() } : {}),
        },
      }),
    );
    return {
      transactionId: transaction.id,
      status: WagerTransactionStatus.Rejected,
      ...(balance ? { balance: balance.toJSON() } : {}),
      failureCode: code,
      idempotentReplay: false,
    };
  }

  private async deferTransaction(
    manager: EntityManager,
    transaction: WagerTransaction,
    balance: Money,
    attempts: number,
    context: ProcessContext,
    emitEvent: boolean,
  ): Promise<WagerResult> {
    transaction.markPendingReference();
    const nextAttemptAt = new Date(Date.now() + Math.min(128, 2 ** attempts) * 1000);
    await manager.query(
      `UPDATE wager_transactions
       SET status = 'PENDING_REFERENCE', failure_code = NULL, processed_at = NULL,
           result_balance = $1, result_balance_currency = $2,
           pending_attempts = $3, next_attempt_at = $4
       WHERE id = $5`,
      [balance.toString(), balance.currency, attempts, nextAttemptAt, transaction.id],
    );
    if (!emitEvent) {
      this.metrics.increment('retries');
    }

    if (emitEvent) {
      const now = new Date();
      await this.enqueueEvent(
        manager,
        new WagerTransactionPendingReference({
          eventId: randomUUID(),
          aggregateId: transaction.walletId,
          correlationId: context.correlationId,
          causationId: transaction.id,
          occurredAt: now,
          data: {
            transactionId: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            walletId: transaction.walletId,
            kind: transaction.kind,
            status: WagerTransactionStatus.PendingReference,
            money: transaction.money.toJSON(),
            balance: balance.toJSON(),
          },
        }),
      );
    }
    return {
      transactionId: transaction.id,
      status: WagerTransactionStatus.PendingReference,
      balance: balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private validateReference(
    transaction: WagerTransaction,
    wallet: Wallet,
    reference: ResolvedReference,
  ): FailureCode | undefined {
    if (reference.status !== WagerTransactionStatus.Processed) {
      return 'REFERENCE_MISMATCH';
    }
    if (
      reference.provider_id !== transaction.providerId ||
      reference.player_id !== transaction.playerId ||
      reference.wallet_id !== wallet.id ||
      reference.round_id !== transaction.roundId ||
      reference.currency.trim() !== transaction.money.currency
    ) {
      return 'REFERENCE_MISMATCH';
    }
    if (
      transaction.kind === WagerTransactionKind.Refund &&
      reference.kind !== WagerTransactionKind.Bet
    ) {
      return 'REFERENCE_KIND_INVALID';
    }
    if (
      transaction.kind === WagerTransactionKind.Rollback &&
      ![
        WagerTransactionKind.Bet,
        WagerTransactionKind.Win,
        WagerTransactionKind.Refund,
      ].includes(reference.kind)
    ) {
      return 'REFERENCE_KIND_INVALID';
    }
    if (
      transaction.kind === WagerTransactionKind.Win &&
      reference.kind !== WagerTransactionKind.Bet
    ) {
      return 'REFERENCE_KIND_INVALID';
    }
    if (
      transaction.kind === WagerTransactionKind.Refund ||
      transaction.kind === WagerTransactionKind.Rollback
    ) {
      const referenceMoney = Money.from({
        amount: this.canonicalAmount(reference.amount),
        currency: reference.currency.trim(),
      });
      if (!referenceMoney.equals(transaction.money)) {
        return 'REFERENCE_AMOUNT_MISMATCH';
      }
    }
    return undefined;
  }

  private isReferenceWaiting(reference: ResolvedReference): boolean {
    return [
      WagerTransactionStatus.Pending,
      WagerTransactionStatus.PendingReference,
    ].includes(reference.status);
  }

  private async insertLedger(
    manager: EntityManager,
    entry: WalletLedgerEntry,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO wallet_ledger_entries (
         id, wallet_id, transaction_id, direction, amount, currency,
         balance_before, balance_after, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.walletId,
        entry.transactionId,
        entry.direction,
        entry.money.toString(),
        entry.money.currency,
        entry.balanceBefore.toString(),
        entry.balanceAfter.toString(),
        entry.createdAt,
      ],
    );
  }

  private async enqueueEvent(
    manager: EntityManager,
    event:
      | WagerTransactionProcessed
      | WagerTransactionRejected
      | WagerTransactionPendingReference
      | WalletBalanceChanged,
  ): Promise<void> {
    const outboxMessage = OutboxMessage.enqueue(event);
    await manager.query(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        outboxMessage.id,
        outboxMessage.aggregateId,
        outboxMessage.eventType,
        JSON.stringify(outboxMessage.payload),
        outboxMessage.occurredAt,
      ],
    );
  }

  private async persistOpeningTransaction(
    manager: EntityManager,
    wallet: Wallet,
    initialBalance: Money,
    at: Date,
  ): Promise<void> {
    const transactionId = randomUUID();
    const externalTransactionId = `opening-${wallet.id}`;
    const openingPayload = {
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      kind: WagerTransactionKind.Opening,
      money: initialBalance.toJSON(),
    };
    const payloadHash = createHash('sha256')
      .update(this.canonicalJson(openingPayload))
      .digest('hex');
    const idempotencyKey = `opening:${wallet.id}`;

    await manager.query(
      `INSERT INTO wager_transactions (
         id, provider_id, external_transaction_id, idempotency_key, payload_hash,
         wallet_id, player_id, round_id, game_id, kind, amount, currency,
         status, processed_at, result_balance, result_balance_currency
       ) VALUES ($1, 'system', $2, $3, $4, $5, $6, 'opening', 'system',
                 'OPENING', $7, $8, 'PROCESSED', $9, $7, $8)`,
      [
        transactionId,
        externalTransactionId,
        idempotencyKey,
        payloadHash,
        wallet.id,
        wallet.playerId,
        initialBalance.toString(),
        initialBalance.currency,
        at,
      ],
    );

    const zero = Money.zero(initialBalance.currency);
    const entry = WalletLedgerEntry.create({
      id: randomUUID(),
      walletId: wallet.id,
      transactionId,
      direction: 'CREDIT',
      money: initialBalance,
      balanceBefore: zero,
      balanceAfter: initialBalance,
      createdAt: at,
    });
    await this.insertLedger(manager, entry);
    await this.enqueueEvent(
      manager,
      new WagerTransactionProcessed({
        eventId: randomUUID(),
        aggregateId: wallet.id,
        correlationId: transactionId,
        occurredAt: at,
        data: {
          transactionId,
          providerId: 'system',
          externalTransactionId,
          walletId: wallet.id,
          kind: WagerTransactionKind.Opening,
          status: WagerTransactionStatus.Processed,
          money: initialBalance.toJSON(),
          balance: initialBalance.toJSON(),
        },
      }),
    );
    await this.enqueueEvent(
      manager,
      new WalletBalanceChanged({
        eventId: randomUUID(),
        aggregateId: wallet.id,
        correlationId: transactionId,
        occurredAt: at,
        data: {
          walletId: wallet.id,
          transactionId,
          direction: 'CREDIT',
          money: initialBalance.toJSON(),
          balanceBefore: zero.toJSON(),
          balanceAfter: initialBalance.toJSON(),
          walletVersion: wallet.version,
        },
      }),
    );
  }

  private parseWager(input: SubmitWagerInput, idempotencyKey: string): {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
  } {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Transaction body is required');
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (idempotencyKey.length > 255) {
      throw new BadRequestException('Idempotency-Key must not exceed 255 characters');
    }

    const required: Array<[string, unknown]> = [
      ['providerId', input.providerId],
      ['externalTransactionId', input.externalTransactionId],
      ['playerId', input.playerId],
      ['walletId', input.walletId],
      ['roundId', input.roundId],
      ['gameId', input.gameId],
    ];
    for (const [field, value] of required) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(`${field} is required`);
      }
    }
    this.assertUuid(input.walletId, 'walletId');

    if (!Object.values(WagerTransactionKind).includes(input.kind as WagerTransactionKind)) {
      throw new BadRequestException('kind is invalid');
    }
    const kind = input.kind as WagerTransactionKind;
    if (kind === WagerTransactionKind.Opening) {
      throw new BadRequestException('OPENING transactions are internal only');
    }
    const money = this.parseMoney(input.money);
    if (!money.isPositive()) {
      throw new BadRequestException('Transaction money must be greater than zero');
    }
    if (
      input.referenceExternalTransactionId !== undefined &&
      (typeof input.referenceExternalTransactionId !== 'string' ||
        input.referenceExternalTransactionId.trim().length === 0)
    ) {
      throw new BadRequestException('referenceExternalTransactionId must be a non-empty string');
    }
    if (
      [WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(kind) &&
      !input.referenceExternalTransactionId
    ) {
      throw new BadRequestException(`${kind} requires referenceExternalTransactionId`);
    }
    if (
      [WagerTransactionKind.Bet, WagerTransactionKind.Loss].includes(kind) &&
      input.referenceExternalTransactionId
    ) {
      throw new BadRequestException(`${kind} cannot reference another transaction`);
    }

    return {
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind,
      money,
      ...(input.referenceExternalTransactionId
        ? { referenceExternalTransactionId: input.referenceExternalTransactionId }
        : {}),
    };
  }

  private parseMoney(value: MoneyProps): Money {
    try {
      return Money.from(value);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'money is invalid',
      );
    }
  }

  private hashBusinessPayload(
    input: ReturnType<WageringService['parseWager']>,
  ): string {
    const businessPayload = {
      externalTransactionId: input.externalTransactionId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money.toJSON(),
      playerId: input.playerId,
      providerId: input.providerId,
      referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
      roundId: input.roundId,
      walletId: input.walletId,
    };
    return createHash('sha256').update(this.canonicalJson(businessPayload)).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
      const sorted = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      return `{${sorted
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`)
        .join(',')}}`;
    }
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new Error('Value cannot be represented as canonical JSON');
    }
    return json;
  }

  private async findByIdempotency(
    manager: EntityManager,
    providerId: string,
    idempotencyKey: string,
  ): Promise<TransactionRow | undefined> {
    const rows = (await manager.query(
      `SELECT * FROM wager_transactions
       WHERE provider_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [providerId, idempotencyKey],
    )) as TransactionRow[];
    return rows[0];
  }

  private resultFromRow(row: TransactionRow, idempotentReplay: boolean): WagerResult {
    return {
      transactionId: row.id,
      status: row.status,
      ...(row.result_balance !== null && row.result_balance_currency
        ? {
            balance: {
              amount: this.canonicalAmount(row.result_balance),
              currency: row.result_balance_currency.trim(),
            },
          }
        : {}),
      ...(row.failure_code ? { failureCode: row.failure_code } : {}),
      idempotentReplay,
    };
  }

  private async markInboxProcessed(
    manager: EntityManager,
    context: ProcessContext,
    inboxMessage: InboxMessage | undefined,
  ): Promise<void> {
    if (context.consumerName && context.messageId) {
      if (!inboxMessage) {
        throw new Error('Inbox domain state is required to mark a message processed');
      }
      inboxMessage.markProcessed(new Date());
      await manager.query(
        `UPDATE inbox_messages SET processed_at = $3
         WHERE consumer_name = $1 AND message_id = $2`,
        [context.consumerName, context.messageId, inboxMessage.processedAt],
      );
    }
  }

  private toWallet(row: WalletRow): Wallet {
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency.trim(),
      balance: {
        amount: this.canonicalAmount(row.balance),
        currency: row.currency.trim(),
      },
      version: Number(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  private toDomain(row: TransactionRow): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind,
      money: {
        amount: this.canonicalAmount(row.amount),
        currency: row.currency.trim(),
      },
      referenceExternalTransactionId:
        row.reference_external_transaction_id ?? undefined,
      createdAt: new Date(row.created_at),
      status: row.status,
      referenceTransactionId: row.reference_transaction_id ?? undefined,
      failureCode: (row.failure_code as FailureCode | null) ?? undefined,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    });
  }

  private walletSummary(wallet: Wallet): WalletSummary {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  private assertUuid(value: string, field: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
  }

  private canonicalAmount(value: string): string {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
    if (!match) {
      throw new Error('Database returned an invalid numeric value');
    }
    const fraction = (match[3] ?? '').padEnd(2, '0');
    if (fraction.length > 2) {
      throw new Error('Database returned money with more than 2 decimal places');
    }
    return `${match[1]}${match[2]}.${fraction}`;
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`).toString('base64url');
  }

  private decodeCursor(cursor: string): { createdAt: string; id: string } {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const separator = decoded.lastIndexOf('|');
      const createdAt = decoded.slice(0, separator);
      const id = decoded.slice(separator + 1);
      if (
        separator < 0 ||
        Number.isNaN(Date.parse(createdAt)) ||
        !UUID_PATTERN.test(id)
      ) {
        throw new Error('Invalid cursor');
      }
      return { createdAt, id };
    } catch {
      throw new BadRequestException('cursor is invalid');
    }
  }

  private isPostgresError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
}
