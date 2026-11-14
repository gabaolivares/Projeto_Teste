import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { WageringService } from '../../application/wagering/wagering.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';

@Injectable()
export class ReferenceRetryWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
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
        await this.wagering.processPendingReferences();
      } catch {
        this.metrics.increment('retries');
        this.logger.warn('wagering.reference_retry_failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
