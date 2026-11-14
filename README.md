# Distributed Wagering Processor

Serviço de processamento financeiro distribuído para operações de apostas, com NestJS, Bun 1.x, PostgreSQL, TypeORM e SQS via LocalStack.

## Requisitos

- Bun 1.x
- Docker Desktop com Docker Compose

## Executar localmente

```powershell
Copy-Item .env.example .env
docker compose up -d
bun install
bun run start:dev
```

O serviço aplica migrations pendentes na inicialização e cria as filas FIFO `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events.fifo`. Por padrão, a API escuta em `http://localhost:3000`.

Com a API em execução, abra `http://localhost:3000/` para usar a interface visual local de criação de carteiras e envio de transações.

PostgreSQL fica em `localhost:5432`; LocalStack SQS em `localhost:4566`. As credenciais do Compose são somente para desenvolvimento local.

## Comandos

```powershell
bun run build
bun run lint
bun run test
bun run test:integration
bun run migration:run
bun run migration:revert
```

As migrations têm `up` e `down`; `migration:revert` desfaz a última migration aplicada. Não execute reversões em produção sem um plano de backup.

## API

- `POST /wallets` cria carteira; saldo positivo cria `OPENING` e lançamento de crédito atômicos.
- `GET /wallets/:walletId`
- `GET /wallets/:walletId/ledger?cursor=<opaco>&limit=50`
- `POST /wallets/:walletId/reconciliation`
- `POST /wagering/transactions` exige `Idempotency-Key`.
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- `GET /health/live` e `GET /health/ready`
- `GET /metrics`

Uma submissão processada retorna `200`, uma referência ainda ausente retorna `202`, uma regra de negócio rejeitada retorna `422`, payload inválido retorna `400` e conflito de idempotência retorna `409`. Falhas transitórias de infraestrutura retornam `5xx` e podem ser reenviadas com a mesma chave.

Exemplo de operação:

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

Envie a operação pela API com o header `Idempotency-Key: provider-a:transaction-123`. O hash SHA-256 é calculado sobre JSON de negócio com chaves ordenadas; headers e metadados de transporte não participam. A mesma chave e payload reproduzem o resultado original.

Para publicar uma mensagem de entrada local, use um cliente SQS compatível com LocalStack. O body precisa seguir o envelope `WagerTransactionRequested` do desafio, incluindo `data.idempotencyKey`. O consumidor usa inbox no PostgreSQL e só apaga a mensagem depois do commit.

## Decisões e limitações

Consulte [ARCHITECTURE.md](./ARCHITECTURE.md) para detalhes de concorrência, schema, eventos, autenticação, retries e trade-offs.
