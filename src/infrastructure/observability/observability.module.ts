import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';
import { StructuredLogger } from './structured-logger.js';

@Module({
  providers: [MetricsService, StructuredLogger],
  exports: [MetricsService, StructuredLogger],
})
export class ObservabilityModule {}
