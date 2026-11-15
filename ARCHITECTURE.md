# Decisões de Arquitetura

## Fronteiras e Camadas

- `src/domain` contém value objects e agregados independentes de framework.
- `src/application` contém os casos de uso transacionais.
- `src/infrastructure` contém as migrations do PostgreSQL, adaptadores SQS, workers, logging e métricas.
- `src/presentation` contém os controllers HTTP e o ponto de extensão de autenticação.

O TypeORM é usado para gerenciamento de conexão/transação com o PostgreSQL e migrations versionadas. A persistência utiliza SQL parametrizado dentro do caso de uso da aplicação para que row locks, `SKIP LOCKED` e as constraints do PostgreSQL permaneçam explícitos.

## Money e Wallet

`Money` armazena unidades menores inteiras (minor units) como `bigint`; nenhuma operação monetária converte através do tipo `number` do JavaScript. Strings de entrada devem ser valores decimais não-negativos com exatamente duas casas fracionárias. A aritmética pode produzir valores intermediários com sinal (para reconciliação e negação), enquanto o `Money.from` de entrada rejeita valores com sinal. Os códigos de moeda devem ser códigos maiúsculos no padrão ISO suportados pelo registro de moedas `Intl` do runtime Bun; todas as moedas seguem o contrato fixo de duas casas decimais do desafio.

`Wallet` é o aggregate root mutável. Cada operação que altera o saldo atualiza o saldo e incrementa sua versão uma vez. Uma movimentação zero é uma no-op (não faz nada). A versão inicial é `1`, incluindo carteiras com saldo inicial; o crédito de abertura é representado por sua própria entrada imutável no ledger.

## PostgreSQL e Concorrência

As operações da wallet rodam em uma única transação do PostgreSQL e travam (lock) apenas a linha da wallet afetada usando `SELECT ... FOR UPDATE`. A atualização também verifica a versão anterior. Linhas de wallets diferentes podem prosseguir concorrentemente; constraints de unicidade no banco fornecem proteção final de idempotência entre as instâncias da aplicação.

O schema impõe unicidade de player/moeda da wallet, saldos não-negativos, escala decimal, chaves únicas de transação, IDs únicos de transação no ledger, aritmética do ledger e referências compostas de moeda entre wallet/transação. Triggers rejeitam a mutação do ledger e a mutação de transações de aposta em estado terminal. Alterações de wallet, status da transação, ledger, inbox e outbox são commitadas atomicamente.

O `NUMERIC` do PostgreSQL é usado para persistência; os valores são sempre passados como strings decimais. Constraints do PostgreSQL e o domínio da aplicação rejeitam saldos negativos. O ledger é append-only (somente adição). A reconciliação compara o saldo materializado da wallet com a soma exata de créditos e débitos do ledger; divergências são reportadas e nunca corrigidas automaticamente.

## Idempotência e Ordem de Referência

A chave persistida é `(provider_id, idempotency_key)`. Um SHA-256 de um JSON canônico dos campos de negócio detecta reuso com payload alterado. Provider e external transaction IDs também são únicos. O saldo original da resposta é armazenado na transação para replay.

Referências ausentes ou ainda pendentes entram em `PENDING_REFERENCE`. Um worker reivindica registros vencidos com row locks e backoff exponencial; após oito tentativas de retry (aproximadamente quatro minutos), ele rejeita a transação com `REFERENCE_NOT_FOUND`. `REFUND` só pode reverter um `BET` processado. `ROLLBACK` pode reverter um `BET`, `WIN` ou `REFUND` processado. Ambos os tipos de reversão exigem valor igual e podem ser usados uma vez por transação referenciada; diferentes tipos de reversão são independentemente únicos conforme especificado pelo desafio.

## Inbox SQS e Outbox Transacional

O SQS é at-least-once. Uma linha de inbox persistente `(consumer_name, message_id)` é inserida na mesma transação SQL do caso de uso de apostas. O consumer deleta/dá ack em uma mensagem apenas após o commit da transação. Rejeições de negócio são commitadas e reconhecidas (ack). Mensagens malformadas e erros permanentes de request/banco de dados são logados em nível de erro; falhas transitórias de infraestrutura são logadas como warnings de retry. Nenhuma delas recebe ack, então a política de redrive da fila FIFO move mensagens que falham repetidamente para a DLQ após cinco recebimentos. O `SIGTERM` interrompe o polling e aguarda a conclusão do loop de recebimento/processamento ativo.

Eventos de integração são envelopes JSON persistidos em `outbox_messages` na mesma transação do estado financeiro. Publishers concorrentes reivindicam linhas usando `FOR UPDATE SKIP LOCKED`, enviam para uma fila FIFO de eventos com event IDs estáveis e marcam publicações bem-sucedidas. Falhas de envio usam retry exponencial limitado. Um crash após o SQS aceitar uma mensagem, mas antes da marcação de publicação no SQL, pode causar uma duplicata; os consumidores devem deduplicar pelo `eventId`.

## Status HTTP e Autenticação

O desafio permite omitir autenticação. Os controllers usam `NoopAuthGuard` como o ponto explícito de substituição; `/health/*` é público. A implantação em produção deve substituir esse guard por um provedor OIDC externo e validar a identidade do provedor na camada de domínio/aplicação.

Os mapeamentos HTTP são: `400` entrada inválida, `409` conflito de idempotência/unicidade ou persistência, `422` rejeição terminal de regra de negócio, `202` referência pendente, `200` processado/replay e `503` readiness ou falha transitória de persistência. Outras falhas de persistência retornam `500` genérico; os clientes devem tentar novamente falhas transitórias usando a mesma idempotency key.

## Observabilidade e Operações

Logs em JSON incluem identificadores disponíveis de correlação, mensagem, transação, wallet, provider e erro, e omitem payloads monetários. `/metrics` expõe contadores de status de transação, duplicatas/retries, profundidade aproximada da DLQ, observações de lock-wait, lag do outbox e agregados de latência de processamento. `/health/live` é a liveness do processo; `/health/ready` verifica PostgreSQL e SQS.

O `docker compose` persiste dados do PostgreSQL e LocalStack em volumes nomeados. As credenciais do Compose local são apenas para desenvolvimento. Defina `SQS_ENDPOINT` com um valor vazio para usar a cadeia de credenciais do AWS SDK em vez do LocalStack.

## Limitações Conhecidas

- O no-op auth guard é deliberadamente não-autenticação (apenas um ponto de extensão).
- As métricas são agregados locais do processo e reiniciam quando o processo reinicia; use um scraper de métricas/coletor OTel para monitoramento durável.
- A entrega do publisher é at-least-once, não exactly-once; os consumidores de eventos devem ser idempotentes.
- A associação de moedas usa a lista de moedas suportadas pelo runtime; a precisão fracionária específica da moeda não é modelada porque o desafio exige um contrato fixo de duas casas decimais.
- A suíte de integração espera que o PostgreSQL e o LocalStack estejam disponíveis através das portas locais do Compose.
