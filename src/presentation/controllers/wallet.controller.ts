import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WageringService } from '../../application/wagering/wagering.service.js';
import { NoopAuthGuard } from '../auth/noop-auth.guard.js';

interface OpenWalletBody {
  readonly playerId: string;
  readonly initialBalance: { readonly amount: string; readonly currency: string };
}

@Controller('wallets')
@UseGuards(NoopAuthGuard)
export class WalletController {
  constructor(private readonly wagering: WageringService) {}

  @Post()
  open(@Body() body: OpenWalletBody) {
    return this.wagering.openWallet(body);
  }

  @Get(':walletId')
  get(@Param('walletId') walletId: string) {
    return this.wagering.getWallet(walletId);
  }

  @Get(':walletId/ledger')
  ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    return this.wagering.listLedger(walletId, cursor, parsedLimit);
  }

  @Post(':walletId/reconciliation')
  reconcile(@Param('walletId') walletId: string) {
    return this.wagering.reconcile(walletId);
  }
}
