import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import * as dotenv from 'dotenv'

dotenv.config()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
  migrate: {
    async adapter() {
      const pool = new Pool({
        connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? '',
        ssl: { rejectUnauthorized: false },
      })
      return new PrismaPg(pool)
    },
  },
})
