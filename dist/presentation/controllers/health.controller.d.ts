import { DataSource } from 'typeorm';
import { SqsService } from '../../infrastructure/messaging/sqs.module.js';
export declare class HealthController {
    private readonly dataSource;
    private readonly sqs;
    constructor(dataSource: DataSource, sqs: SqsService);
    live(): {
        status: string;
    };
    ready(): Promise<{
        status: string;
        checks: {
            postgres: boolean;
            sqs: boolean;
        };
    }>;
}
