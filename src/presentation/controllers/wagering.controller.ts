import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  WageringService,
  type SubmitWagerInput,
} from '../../application/wagering/wagering.service.js';
import { WagerTransactionStatus } from '../../domain/wager-transaction.js';
import { NoopAuthGuard } from '../auth/noop-auth.guard.js';

@Controller()
@UseGuards(NoopAuthGuard)
export class WageringController {
  constructor(private readonly wagering: WageringService) {}

  @Post('wagering/transactions')
  async submit(
    @Body() body: SubmitWagerInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.wagering.submit(body, idempotencyKey ?? '', {
      correlationId:
        correlationId?.trim() ||
        (typeof request.headers['x-correlation-id'] === 'string'
          ? request.headers['x-correlation-id']
          : randomUUID()),
    });

    if (result.status === WagerTransactionStatus.Rejected) {
      response.status(422);
    } else if (result.status === WagerTransactionStatus.PendingReference) {
      response.status(202);
    } else {
      response.status(200);
    }
    return result;
  }

  @Get('wagering/transactions/:transactionId')
  transaction(@Param('transactionId') transactionId: string) {
    return this.wagering.findTransaction(transactionId);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  providerTransaction(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.wagering.findProviderTransaction(providerId, externalTransactionId);
  }
}
