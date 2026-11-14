import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { WageringService, type SubmitWagerInput } from '../../application/wagering/wagering.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
import { SqsService } from '../messaging/sqs.module.js';

interface WagerMessage {
  readonly messageId: string;
  readonly type: string;
  readonly occurredAt?: string;
  readonly correlationId?: string;
  readonly data: SubmitWagerInput & { readonly idempotencyKey: string };
}

export class PermanentSqsMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentSqsMessageError';
  }
}

const transientSqlStates = new Set([
  '40001',
  '40P01',
  '53300',
  '55P03',
  '57014',
  '57P01',
  '57P02',
  '57P03',
]);
const transientNetworkCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

export function classifySqsFailure(error: unknown): 'permanent' | 'transient' {
  if (
    error instanceof PermanentSqsMessageError ||
    error instanceof BadRequestException ||
    error instanceof ConflictException ||
    error instanceof SyntaxError
  ) {
    return 'permanent';
  }

  const code = getErrorCode(error);
  if (
    code?.startsWith('08') ||
    transientSqlStates.has(code ?? '') ||
    transientNetworkCodes.has(code ?? '')
  ) {
    return 'transient';
  }
  if (code && /^[0-9A-Z]{5}$/u.test(code)) {
    return 'permanent';
  }
  return 'transient';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWagerMessage(value: unknown): value is WagerMessage {
  if (
    !isRecord(value) ||
    value['type'] !== 'WagerTransactionRequested' ||
    typeof value['messageId'] !== 'string' ||
    value['messageId'].trim().length === 0 ||
    !isRecord(value['data'])
  ) {
    return false;
  }

  const data = value['data'];
  const money = data['money'];
  return (
    typeof data['idempotencyKey'] === 'string' &&
    typeof data['providerId'] === 'string' &&
    typeof data['externalTransactionId'] === 'string' &&
    typeof data['playerId'] === 'string' &&
    typeof data['walletId'] === 'string' &&
    typeof data['roundId'] === 'string' &&
    typeof data['gameId'] === 'string' &&
    typeof data['kind'] === 'string' &&
    isRecord(money) &&
    typeof money['amount'] === 'string' &&
    typeof money['currency'] === 'string'
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  if ('driverError' in error) {
    const driverCode = getErrorCode(error['driverError']);
    if (driverCode) {
      return driverCode;
    }
  }
  return typeof error['code'] === 'string' ? error['code'] : undefined;
}

@Injectable()
export class SqsTransactionConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly sqs: SqsService,
    private readonly wagering: WageringService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loopPromise = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.sqs.receiveTransactions();
        await Promise.all(messages.map((message) => this.handle(message)));
      } catch {
        this.metrics.increment('retries');
        this.logger.warn('sqs.transaction_poll_failed');
        await this.delay(1000);
      }
    }
  }

  private async handle(message: {
    readonly Body?: string;
    readonly MessageId?: string;
    readonly ReceiptHandle?: string;
  }): Promise<void> {
    if (!message.Body || !message.MessageId || !message.ReceiptHandle) {
      this.logger.error('sqs.transaction_message_incomplete', {
        messageId: message.MessageId,
      });
      return;
    }

    try {
      const envelope: unknown = JSON.parse(message.Body);
      if (!isWagerMessage(envelope)) {
        throw new PermanentSqsMessageError('Invalid SQS transaction message');
      }
      const parsed = envelope;
      const result = await this.wagering.submit(
        parsed.data,
        parsed.data.idempotencyKey,
        {
          correlationId: parsed.correlationId ?? randomUUID(),
          messageId: parsed.messageId,
          consumerName: 'wager-transaction-consumer',
          inboxPayloadHash: createHash('sha256').update(message.Body).digest('hex'),
        },
      );

      await this.sqs.acknowledgeTransaction(message.ReceiptHandle);
      this.logger.info('sqs.transaction_acknowledged', {
        correlationId: parsed.correlationId,
        messageId: parsed.messageId,
        transactionId: result.transactionId,
        walletId: parsed.data.walletId,
        providerId: parsed.data.providerId,
        errorCode: result.failureCode,
      });
    } catch (error) {
      this.metrics.increment('retries');
      const context = {
        messageId: message.MessageId,
        errorCode: getErrorCode(error) ?? (
          error instanceof Error ? error.name : 'UNKNOWN'
        ),
      };
      if (classifySqsFailure(error) === 'permanent') {
        this.logger.error('sqs.transaction_permanent_failure', context);
      } else {
        this.logger.warn('sqs.transaction_retry', context);
      }
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
