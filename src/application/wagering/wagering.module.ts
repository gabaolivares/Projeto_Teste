import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { ObservabilityModule } from '../../infrastructure/observability/observability.module.js';
import { WageringService } from './wagering.service.js';

@Module({
  imports: [DatabaseModule, ObservabilityModule],
  providers: [WageringService],
  exports: [WageringService],
})
export class WageringModule {}
