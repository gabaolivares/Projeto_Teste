import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';
import { SqsService } from '../../infrastructure/messaging/sqs.module.js';

@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly sqs: SqsService,
    private readonly dataSource: DataSource,
    private readonly logger: StructuredLogger,
  ) {}

  @Get('metrics')
  async render(@Res() response: Response): Promise<void> {
    const lag = (await this.dataSource.query(
      `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(occurred_at))), 0)::text AS lag
       FROM outbox_messages WHERE published_at IS NULL`,
    )) as Array<{ lag: string }>;
    this.metrics.setOutboxLag(Number(lag[0]?.lag ?? 0));
    try {
      this.metrics.setDlqMessages(await this.sqs.deadLetterCount());
    } catch (error) {
      this.logger.warn('metrics.dlq_count_unavailable', {
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    }
    response.type('text/plain').send(this.metrics.render());
  }
}
