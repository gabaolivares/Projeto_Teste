import { randomUUID, createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { AppModule } from '../src/app.module.js';
import { MetricsService } from '../src/infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../src/infrastructure/observability/structured-logger.js';
import { SqsService } from '../src/infrastructure/messaging/sqs.module.js';
import { OutboxPublisher } from '../src/infrastructure/workers/outbox-publisher.js';
import { createDataSource } from '../src/infrastructure/database/data-source.js';
import { WageringService, type SubmitWagerInput } from '../src/application/wagering/wagering.service.js';
import { WagerTransactionStatus } from '../src/domain/wager-transaction.js';

describe('Distributed Wagering Processor (PostgreSQL + LocalStack)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let wagering: WageringService;
  let sqs: SqsService;
  let metrics: MetricsService;
  let logger: StructuredLogger;
  let outboxPublisher: OutboxPublisher;

  async function bootApplication(): Promise<void> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    dataSource = app.get(DataSource);
    wagering = app.get(WageringService);
    sqs = app.get(SqsService);
    metrics = app.get(MetricsService);
    logger = app.get(StructuredLogger);
    outboxPublisher = app.get(OutboxPublisher);
  }

  beforeAll(bootApplication, 60_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  async function createWallet(amount: string) {
    return wagering.openWallet({
      playerId: `player-${randomUUID()}`,
      initialBalance: { amount, currency: 'BRL' },
    });
  }

  function bet(
    walletId: string,
    playerId: string,
    externalTransactionId = `bet-${randomUUID()}`,
    amount = '80.00',
  ): SubmitWagerInput {
    return {
      providerId: 'integration-provider',
      externalTransactionId,
      playerId,
      walletId,
      roundId: 'round-integration',
      gameId: 'game-integration',
      kind: 'BET',
      money: { amount, currency: 'BRL' },
    };
  }

  it('passes health checks against the real PostgreSQL and SQS services', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ready', checks: { postgres: true, sqs: true } });
  });

  it('allows exactly one of two concurrent bets to spend a shared balance', async () => {
    const opened = await createWallet('100.00');
    const base = {
      providerId: 'race-provider',
      playerId: opened.playerId,
      walletId: opened.id,
      roundId: 'race-round',
      gameId: 'race-game',
      kind: 'BET',
      money: { amount: '80.00', currency: 'BRL' },
    };
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', `race:${randomUUID()}`)
        .send({ ...base, externalTransactionId: `race-${randomUUID()}` }),
      request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', `race:${randomUUID()}`)
        .send({ ...base, externalTransactionId: `race-${randomUUID()}` }),
    ]);

    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([
      200,
      422,
    ]);
    const wallet = await wagering.getWallet(opened.id);
    expect(wallet.balance).toEqual({ amount: '20.00', currency: 'BRL' });

    const ledger = await wagering.listLedger(opened.id, undefined, 50);
    expect(ledger.entries.filter((entry) => entry.direction === 'DEBIT')).toHaveLength(1);
    const reconciliation = await wagering.reconcile(opened.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.calculatedBalance).toEqual(wallet.balance);
  }, 30_000);

  it('processes separate wallets concurrently without sharing balances', async () => {
    const wallets = await Promise.all([
      createWallet('100.00'),
      createWallet('100.00'),
    ]);

    const results = await Promise.all(
      wallets.map((wallet) => {
        const input = bet(wallet.id, wallet.playerId, `independent-${randomUUID()}`, '70.00');
        return wagering.submit(input, `independent-key-${input.externalTransactionId}`, {
          correlationId: randomUUID(),
        });
      }),
    );

    expect(results.every((result) => result.status === WagerTransactionStatus.Processed)).toBe(
      true,
    );
    expect(
      await Promise.all(wallets.map((wallet) => wagering.getWallet(wallet.id))),
    ).toEqual([
      expect.objectContaining({ balance: { amount: '30.00', currency: 'BRL' } }),
      expect.objectContaining({ balance: { amount: '30.00', currency: 'BRL' } }),
    ]);
  }, 30_000);

  it('enforces ledger immutability and wallet constraints in PostgreSQL', async () => {
    const opened = await createWallet('5.00');
    const entries = (await dataSource.query(
      `SELECT transaction_id FROM wallet_ledger_entries WHERE wallet_id = $1`,
      [opened.id],
    )) as Array<{ transaction_id: string }>;
    expect(entries).toHaveLength(1);

    await expect(
      dataSource.query('UPDATE wallets SET balance = -1 WHERE id = $1', [opened.id]),
    ).rejects.toThrow();
    await expect(
      dataSource.query(
        'UPDATE wallet_ledger_entries SET balance_after = 4.99 WHERE transaction_id = $1',
        [entries[0]?.transaction_id],
      ),
    ).rejects.toThrow();
    await expect(
      dataSource.query('DELETE FROM wager_transactions WHERE id = $1', [
        entries[0]?.transaction_id,
      ]),
    ).rejects.toThrow();

    expect((await wagering.getWallet(opened.id)).balance).toEqual({
      amount: '5.00',
      currency: 'BRL',
    });
  }, 30_000);

  it('applies BET, WIN, LOSS, REFUND and ROLLBACK with the expected ledger effects', async () => {
    const opened = await createWallet('100.00');
    const providerId = `financial-rules-${randomUUID()}`;
    const context = () => ({ correlationId: randomUUID() });
    const submit = (
      kind: SubmitWagerInput['kind'],
      amount: string,
      referenceExternalTransactionId?: string,
    ) => {
      const externalTransactionId = `${kind.toLowerCase()}-${randomUUID()}`;
      return wagering.submit(
        {
          providerId,
          externalTransactionId,
          playerId: opened.playerId,
          walletId: opened.id,
          roundId: 'financial-rules-round',
          gameId: 'financial-rules-game',
          kind,
          money: { amount, currency: 'BRL' },
          ...(referenceExternalTransactionId
            ? { referenceExternalTransactionId }
            : {}),
        },
        `financial-rules-key-${randomUUID()}`,
        context(),
      );
    };

    const betResult = await submit('BET', '20.00');
    const betRow = (await dataSource.query(
      'SELECT external_transaction_id FROM wager_transactions WHERE id = $1',
      [betResult.transactionId],
    )) as Array<{ external_transaction_id: string }>;
    const winResult = await submit('WIN', '15.00');
    const winRow = (await dataSource.query(
      'SELECT external_transaction_id FROM wager_transactions WHERE id = $1',
      [winResult.transactionId],
    )) as Array<{ external_transaction_id: string }>;
    const lossResult = await submit('LOSS', '10.00');

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    expect(winResult.status).toBe(WagerTransactionStatus.Processed);
    expect(lossResult.status).toBe(WagerTransactionStatus.Processed);
    expect(lossResult.balance).toEqual({ amount: '95.00', currency: 'BRL' });

    const refundResult = await submit('REFUND', '20.00', betRow[0]?.external_transaction_id);
    const duplicateRefund = await submit(
      'REFUND',
      '20.00',
      betRow[0]?.external_transaction_id,
    );
    const rollbackResult = await submit(
      'ROLLBACK',
      '15.00',
      winRow[0]?.external_transaction_id,
    );
    const duplicateRollback = await submit(
      'ROLLBACK',
      '15.00',
      winRow[0]?.external_transaction_id,
    );

    expect(refundResult.status).toBe(WagerTransactionStatus.Processed);
    expect(duplicateRefund).toMatchObject({
      status: WagerTransactionStatus.Rejected,
      failureCode: 'ALREADY_REVERSED',
    });
    expect(rollbackResult.status).toBe(WagerTransactionStatus.Processed);
    expect(duplicateRollback).toMatchObject({
      status: WagerTransactionStatus.Rejected,
      failureCode: 'ALREADY_REVERSED',
    });
    expect((await wagering.getWallet(opened.id)).balance).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    const ledger = await wagering.listLedger(opened.id, undefined, 50);
    expect(ledger.entries).toHaveLength(5);
    expect(ledger.entries.map((entry) => entry.transactionId)).not.toContain(
      lossResult.transactionId,
    );
    expect((await wagering.reconcile(opened.id)).consistent).toBe(true);
  }, 30_000);

  it('rolls back inbox, wallet, ledger and outbox together when event persistence fails', async () => {
    const opened = await createWallet('10.00');
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `fail_test_outbox_${suffix}`;
    const triggerName = `fail_test_outbox_${suffix}`;
    const externalTransactionId = `atomicity-${randomUUID()}`;
    const messageId = `atomicity-message-${randomUUID()}`;
    const input = bet(opened.id, opened.playerId, externalTransactionId, '5.00');
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ messageId, input }))
      .digest('hex');
    const outboxBefore = (await dataSource.query(
      'SELECT COUNT(*)::int AS count FROM outbox_messages WHERE aggregate_id = $1',
      [opened.id],
    )) as Array<{ count: number }>;

    try {
      await dataSource.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          IF NEW.aggregate_id = '${opened.id}'::uuid
             AND NEW.event_type = 'WagerTransactionProcessed' THEN
            RAISE EXCEPTION 'intentional atomicity test failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await dataSource.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON outbox_messages
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);

      await expect(
        wagering.submit(input, `atomicity-key-${randomUUID()}`, {
          correlationId: randomUUID(),
          messageId,
          consumerName: 'atomicity-test-consumer',
          inboxPayloadHash: payloadHash,
        }),
      ).rejects.toThrow(/intentional atomicity test failure/u);

      const transactionCount = (await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM wager_transactions WHERE external_transaction_id = $1',
        [externalTransactionId],
      )) as Array<{ count: number }>;
      const inboxCount = (await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2',
        ['atomicity-test-consumer', messageId],
      )) as Array<{ count: number }>;
      const ledgerCount = (await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM wallet_ledger_entries WHERE wallet_id = $1',
        [opened.id],
      )) as Array<{ count: number }>;
      const outboxAfter = (await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM outbox_messages WHERE aggregate_id = $1',
        [opened.id],
      )) as Array<{ count: number }>;

      expect(transactionCount[0]?.count).toBe(0);
      expect(inboxCount[0]?.count).toBe(0);
      expect(ledgerCount[0]?.count).toBe(1);
      expect(outboxAfter[0]?.count).toBe(outboxBefore[0]?.count);
      expect((await wagering.getWallet(opened.id)).balance).toEqual({
        amount: '10.00',
        currency: 'BRL',
      });
    } finally {
      await dataSource.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON outbox_messages`,
      );
      await dataSource.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  }, 30_000);

  it('deduplicates 50 parallel submissions and rejects a conflicting payload', async () => {
    const opened = await createWallet('100.00');
    const input = bet(opened.id, opened.playerId, `parallel-${randomUUID()}`);
    const key = `integration:${input.externalTransactionId}`;
    const context = { correlationId: randomUUID() };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => wagering.submit(input, key, context)),
    );

    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    expect(results.every((result) => result.status === WagerTransactionStatus.Processed)).toBe(
      true,
    );
    expect((await wagering.getWallet(opened.id)).balance).toEqual({
      amount: '20.00',
      currency: 'BRL',
    });

    const ledger = await wagering.listLedger(opened.id, undefined, 50);
    expect(ledger.entries.filter((entry) => entry.direction === 'DEBIT')).toHaveLength(1);
    await expect(
      wagering.submit(
        { ...input, money: { amount: '81.00', currency: 'BRL' } },
        key,
        context,
      ),
    ).rejects.toMatchObject({ status: 409 });
  }, 30_000);

  it('processes a reference delivered before its bet using persistent retry state', async () => {
    const opened = await createWallet('10.00');
    const providerId = 'out-of-order-provider';
    const referenceExternalTransactionId = `late-bet-${randomUUID()}`;
    const refund = await wagering.submit(
      {
        providerId,
        externalTransactionId: `refund-${randomUUID()}`,
        playerId: opened.playerId,
        walletId: opened.id,
        roundId: 'ordered-round',
        gameId: 'ordered-game',
        kind: 'REFUND',
        money: { amount: '5.00', currency: 'BRL' },
        referenceExternalTransactionId,
      },
      `refund-key-${randomUUID()}`,
      { correlationId: randomUUID() },
    );
    expect(refund.status).toBe(WagerTransactionStatus.PendingReference);

    await wagering.submit(
      {
        providerId,
        externalTransactionId: referenceExternalTransactionId,
        playerId: opened.playerId,
        walletId: opened.id,
        roundId: 'ordered-round',
        gameId: 'ordered-game',
        kind: 'BET',
        money: { amount: '5.00', currency: 'BRL' },
      },
      `bet-key-${randomUUID()}`,
      { correlationId: randomUUID() },
    );

    const deadline = Date.now() + 15_000;
    let result = await wagering.findTransaction(refund.transactionId);
    while (
      result.status === WagerTransactionStatus.PendingReference &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      result = await wagering.findTransaction(refund.transactionId);
    }

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect((await wagering.getWallet(opened.id)).balance).toEqual({
      amount: '10.00',
      currency: 'BRL',
    });
  }, 30_000);

  it('uses the SQS consumer, commits inbox and financial effects, then tolerates redelivery', async () => {
    const opened = await createWallet('30.00');
    const input = bet(opened.id, opened.playerId, `sqs-${randomUUID()}`, '7.00');
    const message = {
      messageId: randomUUID(),
      type: 'WagerTransactionRequested' as const,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      data: { ...input, idempotencyKey: `sqs-key-${input.externalTransactionId}` },
    };
    const body = JSON.stringify(message);
    const context = {
      correlationId: message.correlationId,
      messageId: message.messageId,
      consumerName: 'wager-transaction-consumer',
      inboxPayloadHash: createHash('sha256').update(body).digest('hex'),
    };
    const committedBeforeAcknowledgement = await wagering.submit(
      input,
      message.data.idempotencyKey,
      context,
    );
    expect(committedBeforeAcknowledgement).toMatchObject({
      status: WagerTransactionStatus.Processed,
      idempotentReplay: false,
    });

    const sqsMessageId = await sqs.sendTransaction(message);
    expect(sqsMessageId).toBeTruthy();

    const deadline = Date.now() + 15_000;
    let result: Awaited<ReturnType<WageringService['findProviderTransaction']>> | undefined;
    while (!result && Date.now() < deadline) {
      try {
        result = await wagering.findProviderTransaction(
          input.providerId,
          input.externalTransactionId,
        );
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    expect(result?.status).toBe(WagerTransactionStatus.Processed);

    const repeated = await wagering.submit(
      input,
      message.data.idempotencyKey,
      context,
    );
    expect(repeated.idempotentReplay).toBe(true);
    expect((await wagering.getWallet(opened.id)).balance).toEqual({
      amount: '23.00',
      currency: 'BRL',
    });

    const inboxCount = (await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM inbox_messages
       WHERE consumer_name = 'wager-transaction-consumer' AND message_id = $1`,
      [message.messageId],
    )) as Array<{ count: number }>;
    expect(inboxCount[0]?.count).toBe(1);
  }, 30_000);

  it('keeps three independent database clients safe on the same wallet', async () => {
    const opened = await createWallet('100.00');
    const secondDataSource = createDataSource();
    const thirdDataSource = createDataSource();
    await Promise.all([secondDataSource.initialize(), thirdDataSource.initialize()]);
    try {
      await Promise.all([
        secondDataSource.runMigrations({ transaction: 'all' }),
        thirdDataSource.runMigrations({ transaction: 'all' }),
      ]);
      const clients = [
        wagering,
        new WageringService(secondDataSource, metrics, logger),
        new WageringService(thirdDataSource, metrics, logger),
      ];
      const results = await Promise.all(
        clients.map((client) => {
          const input = bet(opened.id, opened.playerId);
          return client.submit(
            input,
            `three-client:${input.externalTransactionId}`,
            { correlationId: randomUUID() },
          );
        }),
      );

      expect(results.filter((result) => result.status === WagerTransactionStatus.Processed)).toHaveLength(1);
      expect(results.filter((result) => result.status === WagerTransactionStatus.Rejected)).toHaveLength(2);
      expect((await wagering.getWallet(opened.id)).balance).toEqual({
        amount: '20.00',
        currency: 'BRL',
      });
    } finally {
      await Promise.all([secondDataSource.destroy(), thirdDataSource.destroy()]);
    }
  }, 30_000);

  it('allows concurrent outbox publishers to claim committed events', async () => {
    const opened = await createWallet('2.00');
    const secondPublisher = new OutboxPublisher(dataSource, sqs, metrics, logger);
    await Promise.all([
      outboxPublisher.publishPendingBatch(),
      secondPublisher.publishPendingBatch(),
    ]);

    const deadline = Date.now() + 15_000;
    let rows = (await dataSource.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE published_at IS NULL)::int AS pending
       FROM outbox_messages
       WHERE aggregate_id = $1`,
      [opened.id],
    )) as Array<{ total: number; pending: number }>;
    while ((rows[0]?.pending ?? 0) > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      rows = (await dataSource.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE published_at IS NULL)::int AS pending
         FROM outbox_messages
         WHERE aggregate_id = $1`,
        [opened.id],
      )) as Array<{ total: number; pending: number }>;
    }

    expect(rows[0]).toEqual({ total: 2, pending: 0 });
  }, 30_000);

  it('configures queue redrive and verifies dead-letter delivery', async () => {
    const client = new SQSClient({
      region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
      endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
    let testQueueUrl: string | undefined;
    let testDeadLetterQueueUrl: string | undefined;

    try {
      const transactionQueue = await client.send(
        new GetQueueUrlCommand({ QueueName: 'wager-transactions.fifo' }),
      );
      const deadLetterQueue = await client.send(
        new GetQueueUrlCommand({ QueueName: 'wager-transactions-dlq.fifo' }),
      );
      if (!transactionQueue.QueueUrl || !deadLetterQueue.QueueUrl) {
        throw new Error('Transaction queue URLs were not returned');
      }
      const transactionAttributes = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: transactionQueue.QueueUrl,
          AttributeNames: ['RedrivePolicy'],
        }),
      );
      const deadLetterAttributes = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: deadLetterQueue.QueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      const redrivePolicy = JSON.parse(
        transactionAttributes.Attributes?.RedrivePolicy ?? '{}',
      ) as { deadLetterTargetArn?: string; maxReceiveCount?: string };
      expect(redrivePolicy.deadLetterTargetArn).toBe(
        deadLetterAttributes.Attributes?.QueueArn,
      );
      expect(Number(redrivePolicy.maxReceiveCount)).toBe(5);

      const suffix = randomUUID();
      const testDeadLetterName = `redrive-test-${suffix}-dlq.fifo`;
      const testQueueName = `redrive-test-${suffix}.fifo`;
      const testDeadLetter = await client.send(
        new CreateQueueCommand({
          QueueName: testDeadLetterName,
          Attributes: { FifoQueue: 'true' },
        }),
      );
      if (!testDeadLetter.QueueUrl) {
        throw new Error('Test DLQ URL was not returned');
      }
      testDeadLetterQueueUrl = testDeadLetter.QueueUrl;
      const testDeadLetterArn = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: testDeadLetter.QueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      if (!testDeadLetterArn.Attributes?.QueueArn) {
        throw new Error('Test DLQ ARN was not returned');
      }
      const testQueue = await client.send(
        new CreateQueueCommand({
          QueueName: testQueueName,
          Attributes: {
            FifoQueue: 'true',
            VisibilityTimeout: '1',
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: testDeadLetterArn.Attributes.QueueArn,
              maxReceiveCount: '2',
            }),
          },
        }),
      );
      if (!testQueue.QueueUrl) {
        throw new Error('Test source queue URL was not returned');
      }
      testQueueUrl = testQueue.QueueUrl;

      const messageId = randomUUID();
      await client.send(
        new SendMessageCommand({
          QueueUrl: testQueue.QueueUrl,
          MessageBody: 'invalid test payload',
          MessageGroupId: `invalid-${messageId}`,
          MessageDeduplicationId: messageId,
        }),
      );

      const deadline = Date.now() + 15_000;
      let deadLetterCount = 0;
      while (deadLetterCount === 0 && Date.now() < deadline) {
        await client.send(
          new ReceiveMessageCommand({
            QueueUrl: testQueue.QueueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 0,
            VisibilityTimeout: 1,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        const attributes = await client.send(
          new GetQueueAttributesCommand({
            QueueUrl: testDeadLetter.QueueUrl,
            AttributeNames: ['ApproximateNumberOfMessages'],
          }),
        );
        deadLetterCount = Number(
          attributes.Attributes?.ApproximateNumberOfMessages ?? 0,
        );
      }

      expect(deadLetterCount).toBeGreaterThan(0);
    } finally {
      try {
        if (testQueueUrl) {
          await client.send(new DeleteQueueCommand({ QueueUrl: testQueueUrl }));
        }
        if (testDeadLetterQueueUrl) {
          await client.send(
            new DeleteQueueCommand({ QueueUrl: testDeadLetterQueueUrl }),
          );
        }
      } finally {
        client.destroy();
      }
    }
  }, 20_000);

  it('recovers a pending reference after the application restarts', async () => {
    const opened = await createWallet('10.00');
    const providerId = 'restart-provider';
    const referenceExternalTransactionId = `restart-bet-${randomUUID()}`;
    const refund = await wagering.submit(
      {
        providerId,
        externalTransactionId: `restart-refund-${randomUUID()}`,
        playerId: opened.playerId,
        walletId: opened.id,
        roundId: 'restart-round',
        gameId: 'restart-game',
        kind: 'REFUND',
        money: { amount: '5.00', currency: 'BRL' },
        referenceExternalTransactionId,
      },
      `restart-refund-key-${randomUUID()}`,
      { correlationId: randomUUID() },
    );
    expect(refund.status).toBe(WagerTransactionStatus.PendingReference);

    await app.close();
    await bootApplication();
    await wagering.submit(
      {
        providerId,
        externalTransactionId: referenceExternalTransactionId,
        playerId: opened.playerId,
        walletId: opened.id,
        roundId: 'restart-round',
        gameId: 'restart-game',
        kind: 'BET',
        money: { amount: '5.00', currency: 'BRL' },
      },
      `restart-bet-key-${randomUUID()}`,
      { correlationId: randomUUID() },
    );

    const deadline = Date.now() + 20_000;
    let result = await wagering.findTransaction(refund.transactionId);
    while (
      result.status === WagerTransactionStatus.PendingReference &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await wagering.findTransaction(refund.transactionId);
    }

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect((await wagering.getWallet(opened.id)).balance).toEqual({
      amount: '10.00',
      currency: 'BRL',
    });
  }, 60_000);
});
