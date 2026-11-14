// Cria a tabela das respostas a comentários escritas no CRM (social_comment_replies). Só ACRESCENTA
// (IF NOT EXISTS): rodar duas vezes não estraga nada. Rodar ANTES de publicar o código que usa a tabela:
//   railway run node scripts/migrar-respostas-comentario.mjs
import pg from 'pg'

const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL não definida (rode com: railway run node scripts/migrar-respostas-comentario.mjs)'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(`
CREATE TABLE IF NOT EXISTS social_comment_replies (
  id                TEXT PRIMARY KEY,
  "engagementId"    TEXT NOT NULL REFERENCES social_engagements(id) ON DELETE CASCADE ON UPDATE CASCADE,
  text              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  "replyExternalId" TEXT,
  error             TEXT,
  "authorUserId"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "social_comment_replies_engagementId_idx" ON social_comment_replies ("engagementId");`)
  const { rows } = await client.query(`select count(*)::int n from information_schema.tables where table_name='social_comment_replies'`)
  console.log(rows[0].n === 1 ? 'OK — tabela social_comment_replies pronta' : 'ERRO — tabela não encontrada')
} finally {
  await client.end()
}
