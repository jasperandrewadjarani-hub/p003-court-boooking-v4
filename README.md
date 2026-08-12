# P003 Court Booking Platform — v4

Multi-tenant court booking platform. Next.js 16 (App Router) + TypeScript +
Tailwind v4 on Vercel, PostgreSQL on Supabase via Prisma 7.

Governed by [`../P_003_V4PromptContract_(2026-08).md`](../P_003_V4PromptContract_(2026-08).md)
and [`../P_003_V4MasterPlan_(2026-08).md`](../P_003_V4MasterPlan_(2026-08).md).
Progress log: [`../notes.md`](../notes.md).

## Stack notes (things that surprised us building Phase 0)

This project was scaffolded against **Next.js 16** and **Prisma 7**, both
newer than most training data and both with real breaking changes:

- **Next.js 16:** `middleware.ts` is renamed `proxy.ts` (exported function is
  `proxy`, not `middleware`). `params`/`searchParams`/`headers()`/`cookies()`
  are async everywhere now. See `node_modules/next/dist/docs/` for the
  version-matched docs before assuming anything from older Next.js knowledge.
- **Prisma 7:** the Rust query engine is gone (TS+WASM); a driver adapter
  (`@prisma/adapter-pg` here) is **mandatory**, not optional. `schema.prisma`'s
  `datasource` block **cannot declare a `url` at all** — connection strings
  live in `prisma.config.ts` (CLI/migrations) and in the adapter constructor
  (runtime). The generator is `prisma-client`, not `prisma-client-js`, and
  requires an explicit `output` path — nothing is generated into
  `node_modules` anymore.
- **Env files:** Prisma's CLI defaults to loading `.env`, not `.env.local`
  (Next.js's own convention). `prisma.config.ts` explicitly loads both, with
  `.env.local` taking precedence, so one file works for `next dev` and the
  Prisma CLI alike.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL (pooled) and DIRECT_URL (direct)
npx prisma generate
npx prisma migrate deploy    # applies existing migrations; use `migrate dev` only when authoring new ones
npx prisma db seed           # seeds >= 2 tenants — never optional, see master plan §5.6
npm run dev
```

Then visit `http://dink-and-dunk.localhost:3000` or
`http://demo-facility.localhost:3000` — plain `localhost:3000` has no tenant
bound to it on purpose (unknown-host must never fall back to a default
tenant, master plan §5.3).

### Two connection strings, not one

Supabase gives you a **pooled** connection (PgBouncer, port 6543 — for the
running app) and a **direct** connection (port 5432 — for migrations only).
Mixing these up is called out in `../P_003_V4MasterPlan_(2026-08).md` §6
as the single most likely serverless+Postgres production bug — PgBouncer's
transaction mode can't run the prepared statements Prisma Migrate needs.

| Var | Used by | Supabase port |
|---|---|---|
| `DATABASE_URL` | `src/lib/db/prisma.ts` (app runtime, via `PrismaPg` adapter) | 6543 (pooled) |
| `DIRECT_URL` | `prisma.config.ts` (CLI: migrate, seed, studio) | 5432 (direct) |

### A gotcha we hit and fixed (worth knowing before Phase 1)

`prisma migrate dev` is interactive by design — if it detects any drift
between the live database and `schema.prisma` it can't reconcile
automatically, it prompts for confirmation, which **hangs forever** in a
non-interactive shell (CI, an agent, etc.) instead of failing loudly. If you
hit this:

1. Don't just wait — diagnose with a read-only command instead:
   `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
2. Hand-author a fix migration (`mkdir prisma/migrations/<timestamp>_<name>`,
   write `migration.sql` yourself) rather than fighting the interactive flow.
3. Apply it with `npx prisma migrate deploy` (non-interactive, safe for
   scripts/CI — this is what actually applies pending migrations without
   ever prompting).
4. If a stuck attempt leaves a stale Postgres advisory lock (symptom:
   `Timed out trying to acquire a postgres advisory lock`), find and clear it:
   `SELECT pid, granted FROM pg_locks WHERE locktype = 'advisory'` to find the
   holder, then `SELECT pg_terminate_backend(<pid>)`.

Two Prisma-schema fields are intentionally raw-SQL, not schema-declared
uniqueness, for exactly this reason — see the header comments on
`TenantDomain.hostname` and `User.email` in `prisma/schema.prisma`: their
uniqueness is a case-insensitive functional index added by
`prisma/migrations/*_booking_constraints_and_rls/migration.sql`, which means
there's no typed `.upsert({ where: { hostname } })` — use `findFirst` +
`create`/`update` instead (see `prisma/seed.ts` for the pattern).

## Deploy

Vercel project connected to this repo; env vars (`DATABASE_URL`, `DIRECT_URL`)
set in the Vercel dashboard, not committed. `postinstall` runs
`prisma generate` automatically on every deploy since the generated client
(`src/generated/prisma/`) is gitignored — regenerated from `schema.prisma`
every time, never committed.
