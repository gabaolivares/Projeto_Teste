import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SqsService } from '../../infrastructure/messaging/sqs.module.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sqs: SqsService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const checks = { postgres: false, sqs: false };
    try {
      await this.dataSource.query('SELECT 1');
      checks.postgres = true;
    } catch {
      checks.postgres = false;
    }
    try {
      await this.sqs.isReachable();
      checks.sqs = true;
    } catch {
      checks.sqs = false;
    }

    if (!checks.postgres || !checks.sqs) {
      throw new ServiceUnavailableException({ status: 'not_ready', checks });
    }
    return { status: 'ready', checks };
  }
}
