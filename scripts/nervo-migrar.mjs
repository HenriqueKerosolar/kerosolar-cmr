// Cria as tabelas duráveis do Nervo (caixa de saída e de entrada) no banco do CRM.
// Usa o SQL OFICIAL da peça @lib/nervo 0.4.2 (nervoPostgresSchemaSql), que é idempotente (IF NOT EXISTS):
// rodar duas vezes não estraga nada; a tabela nervo_connection que já existe não é alterada.
//
// Rodar ANTES de publicar o código que usa as tabelas (regra de convivência):
//   railway run node scripts/nervo-migrar.mjs
import pg from 'pg'
import { nervoPostgresSchemaSql } from '@lib/nervo/postgres'

const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL não definida (rode com: railway run node scripts/nervo-migrar.mjs)'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(nervoPostgresSchemaSql())
  const { rows } = await client.query(`select table_name from information_schema.tables where table_schema='public' and table_name in ('nervo_outbox','nervo_inbox','nervo_connection') order by 1`)
  console.log('OK — tabelas do Nervo no banco:', rows.map((r) => r.table_name).join(', '))
} finally {
  await client.end()
}
