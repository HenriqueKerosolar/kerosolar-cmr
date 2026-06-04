-- =====================================================================
-- KeroSolar CRM — Setup completo do banco
-- Cole isso no Editor SQL do Supabase e clique em "Run"
-- =====================================================================

-- Enums
CREATE TYPE "UserRole"        AS ENUM ('admin', 'agent');
CREATE TYPE "Channel"         AS ENUM ('whatsapp', 'instagram', 'facebook', 'simulator');
CREATE TYPE "LeadStatus"      AS ENUM ('open', 'won', 'lost');
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');
CREATE TYPE "MessageSender"   AS ENUM ('contact', 'ai', 'human', 'system');
CREATE TYPE "TaskStatus"      AS ENUM ('pending', 'completed', 'cancelled');
CREATE TYPE "TaskType"        AS ENUM ('call', 'message', 'meeting', 'followup', 'other');

-- Tabelas
CREATE TABLE "users" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"         TEXT NOT NULL,
  "email"        TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role"         "UserRole" NOT NULL DEFAULT 'agent',
  "avatarUrl"    TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "pipelines" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"      TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "stages" (
  "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "pipelineId" TEXT NOT NULL REFERENCES "pipelines"("id") ON DELETE CASCADE,
  "name"       TEXT NOT NULL,
  "color"      TEXT,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "isWon"      BOOLEAN NOT NULL DEFAULT false,
  "isLost"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "companies" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"      TEXT NOT NULL,
  "phone"     TEXT,
  "email"     TEXT,
  "city"      TEXT,
  "state"     TEXT,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "contacts" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"        TEXT,
  "phone"       TEXT,
  "email"       TEXT,
  "avatarUrl"   TEXT,
  "whatsappId"  TEXT UNIQUE,
  "instagramId" TEXT UNIQUE,
  "facebookId"  TEXT UNIQUE,
  "companyId"   TEXT REFERENCES "companies"("id"),
  "customFields" JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "leads" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"         TEXT NOT NULL,
  "pipelineId"    TEXT NOT NULL REFERENCES "pipelines"("id"),
  "stageId"       TEXT NOT NULL REFERENCES "stages"("id"),
  "contactId"     TEXT REFERENCES "contacts"("id"),
  "companyId"     TEXT REFERENCES "companies"("id"),
  "responsibleId" TEXT REFERENCES "users"("id"),
  "status"        "LeadStatus" NOT NULL DEFAULT 'open',
  "value"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source"        "Channel",
  "lossReason"    TEXT,
  "customFields"  JSONB,
  "aiEnabled"     BOOLEAN NOT NULL DEFAULT true,
  "lastMessageAt" TIMESTAMP(3),
  "closedAt"      TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "conversations" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel"       "Channel" NOT NULL,
  "contactId"     TEXT NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "leadId"        TEXT REFERENCES "leads"("id"),
  "externalId"    TEXT,
  "aiEnabled"     BOOLEAN NOT NULL DEFAULT true,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("channel", "contactId")
);

CREATE TABLE "messages" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversationId" TEXT NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "direction"      "MessageDirection" NOT NULL,
  "senderType"     "MessageSender" NOT NULL,
  "senderUserId"   TEXT,
  "content"        TEXT NOT NULL,
  "mediaUrl"       TEXT,
  "mediaType"      TEXT,
  "externalId"     TEXT,
  "isRead"         BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "tasks" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "leadId"        TEXT REFERENCES "leads"("id") ON DELETE CASCADE,
  "title"         TEXT NOT NULL,
  "type"          "TaskType" NOT NULL DEFAULT 'followup',
  "status"        "TaskStatus" NOT NULL DEFAULT 'pending',
  "dueAt"         TIMESTAMP(3),
  "responsibleId" TEXT REFERENCES "users"("id"),
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "notes" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "leadId"    TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "authorId"  TEXT REFERENCES "users"("id"),
  "type"      TEXT NOT NULL DEFAULT 'note',
  "content"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "channel_integrations" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel"     "Channel" NOT NULL UNIQUE,
  "enabled"     BOOLEAN NOT NULL DEFAULT false,
  "externalId"  TEXT,
  "accessToken" TEXT,
  "verifyToken" TEXT,
  "appSecret"   TEXT,
  "config"      JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "system_configs" (
  "key"       TEXT PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índices
CREATE INDEX ON "stages"        ("pipelineId");
CREATE INDEX ON "contacts"      ("phone");
CREATE INDEX ON "leads"         ("pipelineId", "stageId");
CREATE INDEX ON "leads"         ("contactId");
CREATE INDEX ON "leads"         ("responsibleId");
CREATE INDEX ON "leads"         ("status");
CREATE INDEX ON "conversations" ("leadId");
CREATE INDEX ON "messages"      ("conversationId");
CREATE INDEX ON "tasks"         ("leadId");
CREATE INDEX ON "tasks"         ("dueAt", "status");
CREATE INDEX ON "notes"         ("leadId");

-- Tabela de controle de migrations do Prisma
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                   VARCHAR(36)  PRIMARY KEY,
  "checksum"             VARCHAR(64)  NOT NULL,
  "finished_at"          TIMESTAMPTZ,
  "migration_name"       VARCHAR(255) NOT NULL,
  "logs"                 TEXT,
  "rolled_back_at"       TIMESTAMPTZ,
  "started_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "applied_steps_count"  INTEGER      NOT NULL DEFAULT 0
);

-- ─── Seed: Admin padrão ───────────────────────────────────────────────────────
-- Senha: kerosolar@2025 (hash bcrypt com salt 12)
INSERT INTO "users" ("id", "name", "email", "passwordHash", "role", "isActive", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Administrador',
  'admin@kerosolar.com.br',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdFTj3IXblOm8IvAJhJHk5mJlIym',
  'admin',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO NOTHING;

-- ─── Seed: Funil padrão ───────────────────────────────────────────────────────
WITH new_pipeline AS (
  INSERT INTO "pipelines" ("id", "name", "isDefault", "updatedAt")
  VALUES (gen_random_uuid(), 'Funil KeroSolar', true, CURRENT_TIMESTAMP)
  ON CONFLICT DO NOTHING
  RETURNING "id"
)
INSERT INTO "stages" ("id", "pipelineId", "name", "color", "sortOrder", "isWon", "isLost")
SELECT gen_random_uuid(), p.id, s.name, s.color, s.sort, s.won, s.lost
FROM new_pipeline p
CROSS JOIN (VALUES
  ('Novo',         '#3b82f6', 0, false, false),
  ('Qualificando', '#eab308', 1, false, false),
  ('Orçamento',    '#f97316', 2, false, false),
  ('Negociação',   '#a855f7', 3, false, false),
  ('Ganho',        '#22c55e', 4, true,  false),
  ('Perdido',      '#ef4444', 5, false, true)
) AS s(name, color, sort, won, lost);

SELECT 'Setup completo! ✓ Tabelas criadas, admin e funil inseridos.' AS status;
