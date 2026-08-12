import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Plain `dotenv/config` only loads `.env`, but this project follows Next.js's
// own convention of keeping local secrets in `.env.local` (already covered
// by the `.env*` gitignore rule) so one file works for both `next dev` and
// the Prisma CLI. `.env` is loaded first as a fallback for values that
// genuinely are safe to share across environments (there are none yet).
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

// Prisma 7: the CLI (migrate/introspect/studio) no longer reads DATABASE_URL
// implicitly. This is the DIRECT (non-pooled, port 5432) connection —
// PgBouncer's transaction-mode pooler on 6543 does not support the prepared
// statements Prisma Migrate needs. The pooled connection is used only by the
// app's runtime PrismaClient (src/lib/db/prisma.ts), never here.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
