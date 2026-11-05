// Liga o ConnectionStore do Nervo (@lib/nervo/postgres) ao Postgres deste CRM pelo Prisma que o resto do app já usa.
import type { PgQuery } from '@lib/nervo'

/** O mínimo que precisamos do Prisma (injetável nos testes). */
export interface RawQueryClient {
  $queryRawUnsafe(sql: string, ...values: unknown[]): Promise<unknown>
}

const INT4_MAX = 2_147_483_647

/**
 * Prisma manda número inteiro como int4 quando cabe e falha ("number too large") com milissegundos de
 * época. Inteiros grandes viram BigInt (int8). Valores sempre entram por parâmetro posicional ($1, $2...).
 */
function toParam(value: unknown): unknown {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) > INT4_MAX ? BigInt(value) : value
}

export function createPrismaQuery(client: RawQueryClient): PgQuery {
  return async (sql, params = []) => {
    const rows = await client.$queryRawUnsafe(sql, ...params.map(toParam))
    return { rows: (Array.isArray(rows) ? rows : []) as Record<string, unknown>[] }
  }
}
