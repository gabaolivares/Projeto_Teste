export class InitialWageringSchema1710000000000 {
    name = 'InitialWageringSchema1710000000000';
    async up(queryRunner) {
        await queryRunner.query(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY,
        player_id TEXT NOT NULL,
        currency CHAR(3) NOT NULL,
        balance NUMERIC NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT wallets_player_currency_unique UNIQUE (player_id, currency),
        CONSTRAINT wallets_id_currency_unique UNIQUE (id, currency),
        CONSTRAINT wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0 AND scale(balance) <= 2),
        CONSTRAINT wallets_version_positive CHECK (version >= 1)
      )
    `);
        await queryRunner.query(`
      CREATE TABLE wager_transactions (
        id UUID PRIMARY KEY,
        provider_id TEXT NOT NULL,
        external_transaction_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        wallet_id UUID NOT NULL,
        player_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        currency CHAR(3) NOT NULL,
        reference_external_transaction_id TEXT,
        reference_transaction_id UUID REFERENCES wager_transactions(id),
        status TEXT NOT NULL,
        failure_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ,
        pending_attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        result_balance NUMERIC,
        result_balance_currency CHAR(3),
        CONSTRAINT wager_transactions_provider_idempotency_unique
          UNIQUE (provider_id, idempotency_key),
        CONSTRAINT wager_transactions_provider_external_unique
          UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wager_transactions_id_wallet_currency_unique
          UNIQUE (id, wallet_id, currency),
        CONSTRAINT wager_transactions_kind_valid
          CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        CONSTRAINT wager_transactions_status_valid
          CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        CONSTRAINT wager_transactions_payload_hash_valid
          CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT wager_transactions_amount_positive
          CHECK (amount > 0 AND scale(amount) <= 2),
        CONSTRAINT wager_transactions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT wager_transactions_pending_attempts_non_negative CHECK (pending_attempts >= 0),
        CONSTRAINT wager_transactions_reference_required
          CHECK (kind NOT IN ('REFUND', 'ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
        CONSTRAINT wager_transactions_result_balance_valid
          CHECK (
            (result_balance IS NULL AND result_balance_currency IS NULL) OR
            (result_balance IS NOT NULL AND result_balance >= 0 AND scale(result_balance) <= 2
              AND result_balance_currency IS NOT NULL)
          )
      )
    `);
        await queryRunner.query(`
      CREATE INDEX wager_transactions_pending_due
      ON wager_transactions (next_attempt_at, created_at)
      WHERE status = 'PENDING_REFERENCE'
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX wager_transactions_refund_once
      ON wager_transactions (reference_transaction_id)
      WHERE kind = 'REFUND' AND reference_transaction_id IS NOT NULL
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX wager_transactions_rollback_once
      ON wager_transactions (reference_transaction_id)
      WHERE kind = 'ROLLBACK' AND reference_transaction_id IS NOT NULL
    `);
        await queryRunner.query(`
      CREATE TABLE wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        transaction_id UUID NOT NULL UNIQUE REFERENCES wager_transactions(id),
        direction TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        currency CHAR(3) NOT NULL,
        balance_before NUMERIC NOT NULL,
        balance_after NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT wallet_ledger_direction_valid CHECK (direction IN ('DEBIT', 'CREDIT')),
        CONSTRAINT wallet_ledger_amount_positive CHECK (amount > 0 AND scale(amount) <= 2),
        CONSTRAINT wallet_ledger_balances_valid
          CHECK (
            balance_before >= 0 AND balance_after >= 0
            AND scale(balance_before) <= 2 AND scale(balance_after) <= 2
            AND (
              (direction = 'DEBIT' AND balance_before - amount = balance_after) OR
              (direction = 'CREDIT' AND balance_before + amount = balance_after)
            )
          ),
        CONSTRAINT wallet_ledger_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT wallet_ledger_wallet_currency_fk
          FOREIGN KEY (wallet_id, currency) REFERENCES wallets (id, currency),
        CONSTRAINT wallet_ledger_transaction_wallet_currency_fk
          FOREIGN KEY (transaction_id, wallet_id, currency)
          REFERENCES wager_transactions (id, wallet_id, currency)
      )
    `);
        await queryRunner.query(`
      CREATE INDEX wallet_ledger_wallet_created_id
      ON wallet_ledger_entries (wallet_id, created_at DESC, id DESC)
    `);
        await queryRunner.query(`
      CREATE FUNCTION prevent_wallet_ledger_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'wallet ledger entries are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
        await queryRunner.query(`
      CREATE TRIGGER wallet_ledger_entries_immutable
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_wallet_ledger_mutation()
    `);
        await queryRunner.query(`
      CREATE FUNCTION prevent_terminal_wager_mutation() RETURNS trigger AS $$
      BEGIN
        IF OLD.status IN ('PROCESSED', 'REJECTED', 'FAILED') THEN
          RAISE EXCEPTION 'terminal wager transactions are immutable';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
        await queryRunner.query(`
      CREATE TRIGGER wager_transactions_terminal_immutable
      BEFORE UPDATE OR DELETE ON wager_transactions
      FOR EACH ROW EXECUTE FUNCTION prevent_terminal_wager_mutation()
    `);
        await queryRunner.query(`
      CREATE TABLE inbox_messages (
        consumer_name TEXT NOT NULL,
        message_id TEXT NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ,
        PRIMARY KEY (consumer_name, message_id),
        CONSTRAINT inbox_payload_hash_valid CHECK (payload_hash ~ '^[a-f0-9]{64}$')
      )
    `);
        await queryRunner.query(`
      CREATE TABLE outbox_messages (
        id UUID PRIMARY KEY,
        aggregate_id UUID NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ,
        CONSTRAINT outbox_attempts_non_negative CHECK (attempts >= 0)
      )
    `);
        await queryRunner.query(`
      CREATE INDEX outbox_pending_due
      ON outbox_messages (next_attempt_at, occurred_at)
      WHERE published_at IS NULL
    `);
    }
    async down(queryRunner) {
        await queryRunner.query('DROP TABLE IF EXISTS outbox_messages');
        await queryRunner.query('DROP TABLE IF EXISTS inbox_messages');
        await queryRunner.query('DROP TRIGGER IF EXISTS wager_transactions_terminal_immutable ON wager_transactions');
        await queryRunner.query('DROP FUNCTION IF EXISTS prevent_terminal_wager_mutation()');
        await queryRunner.query('DROP TRIGGER IF EXISTS wallet_ledger_entries_immutable ON wallet_ledger_entries');
        await queryRunner.query('DROP TABLE IF EXISTS wallet_ledger_entries');
        await queryRunner.query('DROP FUNCTION IF EXISTS prevent_wallet_ledger_mutation()');
        await queryRunner.query('DROP TABLE IF EXISTS wager_transactions');
        await queryRunner.query('DROP TABLE IF EXISTS wallets');
    }
}
//# sourceMappingURL=1710000000000-InitialWageringSchema.js.map