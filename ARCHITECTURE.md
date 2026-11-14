# Architecture decisions

## Boundaries

- `src/domain` contains framework-free value objects and aggregates.
- `src/application` contains transactional use cases.
- `src/infrastructure` contains PostgreSQL migrations, SQS adapters, workers, logging, and metrics.
- `src/presentation` contains HTTP controllers and the authentication extension point.

TypeORM is used for PostgreSQL connection/transaction management and versioned migrations. Persistence uses parameterized SQL inside the application use case so row locks, `SKIP LOCKED`, and PostgreSQL constraints remain explicit.

## Money and wallet

`Money` stores integer minor units as `bigint`; no monetary operation converts through JavaScript `number`. Input strings must be non-negative decimal values with exactly two fractional digits. Arithmetic can produce signed intermediate values (for reconciliation and negation), while inbound `Money.from` rejects signed values. Currency codes must be uppercase ISO-style codes supported by the Bun runtime's `Intl` currency registry; all currencies follow the challenge's fixed two-decimal contract.

`Wallet` is the mutable aggregate root. Each balance-changing operation updates the balance and increments its version once. A zero movement is a no-op. Opening version is `1`, including wallets with an initial balance; the opening credit is represented by its own immutable ledger entry.

## PostgreSQL and concurrency

Wallet operations run in one PostgreSQL transaction and lock only the affected wallet row using `SELECT ... FOR UPDATE`. The update also checks the previous version. Different wallet rows can proceed concurrently; unique database constraints provide final idempotency protection across application instances.

The schema enforces player/currency wallet uniqueness, non-negative balances, decimal scale, unique transaction keys, unique ledger transaction IDs, ledger arithmetic, and composite wallet/transaction currency references. Triggers reject ledger mutation and mutation of terminal wager transactions. Wallet changes, transaction status, ledger, inbox, and outbox are committed atomically.

PostgreSQL `NUMERIC` is used for persistence; values are always bound as decimal strings. PostgreSQL constraints and the application domain both reject negative balances. The ledger is append-only. Reconciliation compares the materialized wallet amount with the exact sum of ledger credits and debits; discrepancies are reported and never repaired automatically.

## Idempotency and reference order

The persisted key is `(provider_id, idempotency_key)`. A SHA-256 of canonical JSON for business fields detects reuse with a changed payload. Provider and external transaction IDs are also unique. The original response balance is stored on the transaction for replay.

Missing or still-pending references enter `PENDING_REFERENCE`. A worker claims due records with row locks and exponential backoff; after eight retry attempts (approximately four minutes), it rejects the transaction with `REFERENCE_NOT_FOUND`. REFUND may only reverse a processed BET. ROLLBACK may reverse a processed BET, WIN, or REFUND. Both reversal kinds require equal amount and can each be used once per referenced transaction; different reversal kinds are independently unique as specified by the challenge.

## SQS inbox and transactional outbox

SQS is at-least-once. A persistent `(consumer_name, message_id)` inbox row is inserted in the same SQL transaction as the wagering use case. The consumer deletes/acks a message only after the transaction commits. Business rejections are committed and acknowledged. Malformed messages and permanent request/database errors are logged at error level; transient infrastructure failures are logged as retry warnings. Neither is acknowledged, so the FIFO queue redrive policy moves repeatedly failing messages to the DLQ after five receives. SIGTERM stops polling and waits for an active receive/processing loop to finish.

Integration events are JSON envelopes persisted in `outbox_messages` in the same transaction as the financial state. Concurrent publishers claim rows using `FOR UPDATE SKIP LOCKED`, send to a FIFO event queue with stable event IDs, and mark successful publications. Send failures use capped exponential retry. A crash after SQS accepted a message but before the SQL publication mark can cause a duplicate; consumers must deduplicate by `eventId`.

## HTTP status and authentication

The challenge permits omitting authentication. Controllers use `NoopAuthGuard` as the explicit replacement point; `/health/*` is public. Production deployment must replace this guard with an external OIDC provider and validate the provider identity in the domain/application layer.

HTTP mappings are: `400` invalid input, `409` idempotency/uniqueness or persistence conflict, `422` terminal business rejection, `202` pending reference, `200` processed/replay, and `503` readiness or transient persistence failure. Other persistence failures return a generic `500`; clients should retry transient failures using the same idempotency key.

## Observability and operations

JSON logs include available correlation, message, transaction, wallet, provider, and error identifiers, and omit monetary payloads. `/metrics` exposes transaction status counts, duplicate/retry counters, approximate DLQ depth, lock-wait observations, outbox lag, and processing latency aggregates. `/health/live` is process liveness; `/health/ready` checks PostgreSQL and SQS.

`docker compose` persists PostgreSQL and LocalStack data in named volumes. The local Compose credentials are for development only. Set `SQS_ENDPOINT` to an empty value to use the AWS SDK credential chain instead of LocalStack.

## Known limitations

- The no-op auth guard is deliberately not authentication.
- Metrics are process-local aggregates and reset on process restart; use a metrics scraper/OTel collector for durable monitoring.
- Publisher delivery is at-least-once, not exactly-once; event consumers must be idempotent.
- Currency membership uses the runtime's supported currency list; currency-specific fractional precision is not modeled because the challenge requires a fixed two-decimal contract.
- The integration suite expects PostgreSQL and LocalStack to be available through the local Compose ports.
