import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  ReceiveMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
  SendMessageCommand,
  DeleteMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';

@Injectable()
export class SqsService implements OnModuleInit {
  private transactionQueueUrl = '';
  private deadLetterQueueUrl = '';
  private eventQueueUrl = '';
  private visibilityTimeoutSeconds = 60;

  private readonly client = new SQSClient({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    ...(process.env.SQS_ENDPOINT === ''
      ? {}
      : {
          endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        }),
  });

  async onModuleInit(): Promise<void> {
    const deadLetterName = 'wager-transactions-dlq.fifo';
    const transactionName = 'wager-transactions.fifo';
    const eventName = 'wager-events.fifo';
    const configuredVisibilityTimeout = process.env.SQS_VISIBILITY_TIMEOUT ?? '60';
    if (!/^\d+$/u.test(configuredVisibilityTimeout)) {
      throw new Error('SQS_VISIBILITY_TIMEOUT must be an integer from 1 to 43200');
    }
    this.visibilityTimeoutSeconds = Number(configuredVisibilityTimeout);
    if (
      this.visibilityTimeoutSeconds < 1 ||
      this.visibilityTimeoutSeconds > 43200
    ) {
      throw new Error('SQS_VISIBILITY_TIMEOUT must be an integer from 1 to 43200');
    }

    this.deadLetterQueueUrl = await this.createQueue(deadLetterName, {
      FifoQueue: 'true',
      MessageRetentionPeriod: '1209600',
    });
    const deadLetterAttributes = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.deadLetterQueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
    const deadLetterArn = deadLetterAttributes.Attributes?.QueueArn;
    if (!deadLetterArn) {
      throw new Error('SQS did not return the transaction DLQ ARN');
    }

    this.transactionQueueUrl = await this.createQueue(transactionName, {
      FifoQueue: 'true',
      VisibilityTimeout: String(this.visibilityTimeoutSeconds),
      ReceiveMessageWaitTimeSeconds: '5',
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: deadLetterArn,
        maxReceiveCount: '5',
      }),
    });
    this.eventQueueUrl = await this.createQueue(eventName, {
      FifoQueue: 'true',
      VisibilityTimeout: '60',
      ReceiveMessageWaitTimeSeconds: '20',
    });
  }

  async receiveTransactions(): Promise<Message[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.transactionQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5,
        VisibilityTimeout: this.visibilityTimeoutSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    return response.Messages ?? [];
  }

  async acknowledgeTransaction(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.transactionQueueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  async sendTransaction(message: {
    readonly messageId: string;
    readonly type: 'WagerTransactionRequested';
    readonly occurredAt: string;
    readonly correlationId?: string;
    readonly data: {
      readonly walletId: string;
      readonly idempotencyKey: string;
    } & Record<string, unknown>;
  }): Promise<string> {
    const result = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.transactionQueueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: message.data.walletId,
        MessageDeduplicationId: message.messageId,
      }),
    );
    if (!result.MessageId) {
      throw new Error('SQS did not return a message ID');
    }
    return result.MessageId;
  }

  async publishEvent(event: {
    readonly eventId: string;
    readonly aggregateId: string;
    readonly eventType: string;
    readonly occurredAt: string;
    readonly [key: string]: unknown;
  }): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.eventQueueUrl,
        MessageBody: JSON.stringify(event),
        MessageGroupId: event.aggregateId,
        MessageDeduplicationId: event.eventId,
      }),
    );
  }

  async isReachable(): Promise<void> {
    await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.transactionQueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
  }

  async deadLetterCount(): Promise<number> {
    const result = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.deadLetterQueueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    return Number(result.Attributes?.ApproximateNumberOfMessages ?? 0);
  }

  private async createQueue(
    queueName: string,
    attributes: Record<string, string>,
  ): Promise<string> {
    const listed = await this.client.send(
      new ListQueuesCommand({ QueueNamePrefix: queueName }),
    );
    let queueUrl = listed.QueueUrls?.find((url) => url.endsWith(`/${queueName}`));
    if (!queueUrl) {
      await this.client.send(
        new CreateQueueCommand({
          QueueName: queueName,
          Attributes: attributes,
        }),
      );
      const queue = await this.client.send(
        new GetQueueUrlCommand({ QueueName: queueName }),
      );
      queueUrl = queue.QueueUrl;
    } else {
      await this.client.send(
        new SetQueueAttributesCommand({
          QueueUrl: queueUrl,
          Attributes: attributes,
        }),
      );
    }

    if (!queueUrl) {
      throw new Error(`SQS did not return a URL for ${queueName}`);
    }
    return queueUrl;
  }
}

@Module({
  providers: [SqsService],
  exports: [SqsService],
})
export class SqsModule {}
