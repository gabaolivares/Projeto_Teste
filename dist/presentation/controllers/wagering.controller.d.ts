import type { Request, Response } from 'express';
import { WageringService, type SubmitWagerInput } from '../../application/wagering/wagering.service.js';
export declare class WageringController {
    private readonly wagering;
    constructor(wagering: WageringService);
    submit(body: SubmitWagerInput, idempotencyKey: string | undefined, correlationId: string | undefined, request: Request, response: Response): Promise<import("../../application/wagering/wagering.service.js").WagerResult>;
    transaction(transactionId: string): Promise<import("../../application/wagering/wagering.service.js").WagerResult>;
    providerTransaction(providerId: string, externalTransactionId: string): Promise<import("../../application/wagering/wagering.service.js").WagerResult>;
}
