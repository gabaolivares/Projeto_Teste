var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable, Module } from '@nestjs/common';
import { CreateQueueCommand, GetQueueAttributesCommand, GetQueueUrlCommand, ListQueuesCommand, ReceiveMessageCommand, SetQueueAttributesCommand, SQSClient, SendMessageCommand, DeleteMessageCommand, } from '@aws-sdk/client-sqs';
let SqsService = class SqsService {
    transactionQueueUrl = '';
    deadLetterQueueUrl = '';
    eventQueueUrl = '';
    visibilityTimeoutSeconds = 60;
    client = new SQSClient({
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
    async onModuleInit() {
        const deadLetterName = 'wager-transactions-dlq.fifo';
        const transactionName = 'wager-transactions.fifo';
        const eventName = 'wager-events.fifo';
        const configuredVisibilityTimeout = process.env.SQS_VISIBILITY_TIMEOUT ?? '60';
        if (!/^\d+$/u.test(configuredVisibilityTimeout)) {
            throw new Error('SQS_VISIBILITY_TIMEOUT must be an integer from 1 to 43200');
        }
        this.visibilityTimeoutSeconds = Number(configuredVisibilityTimeout);
        if (this.visibilityTimeoutSeconds < 1 ||
            this.visibilityTimeoutSeconds > 43200) {
            throw new Error('SQS_VISIBILITY_TIMEOUT must be an integer from 1 to 43200');
        }
        this.deadLetterQueueUrl = await this.createQueue(deadLetterName, {
            FifoQueue: 'true',
            MessageRetentionPeriod: '1209600',
        });
        const deadLetterAttributes = await this.client.send(new GetQueueAttributesCommand({
            QueueUrl: this.deadLetterQueueUrl,
            AttributeNames: ['QueueArn'],
        }));
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
    async receiveTransactions() {
        const response = await this.client.send(new ReceiveMessageCommand({
            QueueUrl: this.transactionQueueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5,
            VisibilityTimeout: this.visibilityTimeoutSeconds,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        }));
        return response.Messages ?? [];
    }
    async acknowledgeTransaction(receiptHandle) {
        await this.client.send(new DeleteMessageCommand({
            QueueUrl: this.transactionQueueUrl,
            ReceiptHandle: receiptHandle,
        }));
    }
    async sendTransaction(message) {
        const result = await this.client.send(new SendMessageCommand({
            QueueUrl: this.transactionQueueUrl,
            MessageBody: JSON.stringify(message),
            MessageGroupId: message.data.walletId,
            MessageDeduplicationId: message.messageId,
        }));
        if (!result.MessageId) {
            throw new Error('SQS did not return a message ID');
        }
        return result.MessageId;
    }
    async publishEvent(event) {
        await this.client.send(new SendMessageCommand({
            QueueUrl: this.eventQueueUrl,
            MessageBody: JSON.stringify(event),
            MessageGroupId: event.aggregateId,
            MessageDeduplicationId: event.eventId,
        }));
    }
    async isReachable() {
        await this.client.send(new GetQueueAttributesCommand({
            QueueUrl: this.transactionQueueUrl,
            AttributeNames: ['QueueArn'],
        }));
    }
    async deadLetterCount() {
        const result = await this.client.send(new GetQueueAttributesCommand({
            QueueUrl: this.deadLetterQueueUrl,
            AttributeNames: ['ApproximateNumberOfMessages'],
        }));
        return Number(result.Attributes?.ApproximateNumberOfMessages ?? 0);
    }
    async createQueue(queueName, attributes) {
        const listed = await this.client.send(new ListQueuesCommand({ QueueNamePrefix: queueName }));
        let queueUrl = listed.QueueUrls?.find((url) => url.endsWith(`/${queueName}`));
        if (!queueUrl) {
            await this.client.send(new CreateQueueCommand({
                QueueName: queueName,
                Attributes: attributes,
            }));
            const queue = await this.client.send(new GetQueueUrlCommand({ QueueName: queueName }));
            queueUrl = queue.QueueUrl;
        }
        else {
            await this.client.send(new SetQueueAttributesCommand({
                QueueUrl: queueUrl,
                Attributes: attributes,
            }));
        }
        if (!queueUrl) {
            throw new Error(`SQS did not return a URL for ${queueName}`);
        }
        return queueUrl;
    }
};
SqsService = __decorate([
    Injectable()
], SqsService);
export { SqsService };
let SqsModule = class SqsModule {
};
SqsModule = __decorate([
    Module({
        providers: [SqsService],
        exports: [SqsService],
    })
], SqsModule);
export { SqsModule };
//# sourceMappingURL=sqs.module.js.map