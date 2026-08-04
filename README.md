# AI Voice Cold Calling Sales Agent

A real-time AI appointment setter for residential solar. Speaks with homeowners in the browser,
qualifies them against the sales methodology, handles objections, books consultations, and stores
everything in Supabase.

**Status:** Working end to end. A visitor can hold a spoken conversation with the agent, be
qualified against the sales methodology, and land in the CRM as a scored lead. Milestone detail
and what remains is in [implementation.md](implementation.md).

---

## Quick start

```bash
pnpm install

# Fill in credentials (see "Configuration" below)
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Apply the database schema — see "Database" below
pnpm db:bundle

pnpm dev          # backend :8787 + frontend :3000
```

Check it came up:

```bash
curl http://localhost:8787/api/health   # liveness, no downstream calls
curl http://localhost:8787/api/ready    # actually pings Supabase and the LLM
```

## Layout

```
frontend/     Next.js 15 App Router — call widget + admin dashboard  → Vercel
backend/      Hono + TypeScript API                                  → Vercel Functions
supabase/     migrations/ (20 files) + generated bundle.sql
docs/         knowledge/ — the 7 extracted source-of-truth documents
scripts/      build tooling
```

`frontend/` and `backend/` are a pnpm workspace. The directory names from `claude.md` §12
(`agents/`, `voice/`, `services/`, `hooks/`, …) live inside whichever side owns them.

## Configuration

Every value is documented inline in `backend/.env.example` and `frontend/.env.example`.

**Required to boot:**

| Where | Variable | Notes |
| --- | --- | --- |
| backend | `GLM_API_KEY`, `GLM_BASE_URL` | Anthropic-shaped endpoint (decision D9) |
| backend | `SUPABASE_URL` | The **API project URL**, not the `postgresql://` connection string |
| backend | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | |
| backend | `CALL_TOKEN_SECRET` | ≥32 chars — `openssl rand -hex 32` |
| frontend | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key only |

The backend validates all of it at startup and refuses to run on a bad config, listing every
problem at once. Secrets are never printed — the boot banner reports them as `set`/`unset`.

> **Never** put `SUPABASE_SERVICE_ROLE_KEY` or any LLM key in `frontend/.env.local`. Everything
> prefixed `NEXT_PUBLIC_` is compiled into the browser bundle and is publicly readable.

## Database

20 migrations in `supabase/migrations/`, each idempotent and safe to re-run.

**Option A — SQL Editor (no database password needed):**

```bash
pnpm db:bundle     # → supabase/bundle.sql
```

Paste that file into the Supabase SQL Editor and run it.

**Option B — Supabase CLI:**

```bash
npx supabase link --project-ref <your-ref>
pnpm db:push
pnpm db:types      # regenerate backend/src/types/database.ts
```

Schema, RLS policies, and constraints are described in [database.md](database.md).

## Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Run both apps |
| `pnpm verify` | typecheck + lint + test — run before every commit |
| `pnpm typecheck` | Strict TS across both packages |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (backend) |
| `pnpm db:bundle` | Regenerate `supabase/bundle.sql` |

## Documentation

| File | Contents |
| --- | --- |
| [claude.md](claude.md) | The original brief |
| [implementation.md](implementation.md) | Architecture, decisions, milestones, risks |
| [database.md](database.md) | Schema, RLS, storage, analytics views |
| [docs/knowledge/](docs/knowledge/) | The 7 extracted documents the agent reasons from |

The knowledge documents are the **only** source of product facts. The agent never invents a company
name, price, or incentive — anything not in those files triggers the fallback in
[fallback-responses.md](docs/knowledge/fallback-responses.md).

## Before this handles a real call

- [ ] Real identity values in `backend/.env` §5 — the agent speaks them aloud
- [ ] Compliance review of the sales script (implementation.md R1, R2)
- [ ] Decide R14 — the LLM key is a coding-plan subscription
- [ ] Decide R15 — the LLM is China-hosted, and leads are US homeowner data
- [ ] Answer Q7 — the recap promises a confirmation text the system does not send

---

## Deploying to Vercel

`frontend/` and `backend/` are **two separate Vercel projects** from the same repository.

### Backend

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Framework Preset | Other |
| Build Command | `pnpm typecheck` |
| Install Command | `pnpm install` |

Environment variables — copy from `backend/.env`:
`GLM_API_KEY` · `GLM_BASE_URL` · `GLM_API_STYLE` · `GLM_MODEL` · `GLM_EXTRACTOR_MODEL` ·
`LLM_PROVIDER` · `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` ·
`CALL_TOKEN_SECRET` · `ALLOWED_ORIGINS` (set to your frontend's URL) ·
`COMPANY_NAME` · `AGENT_NAME` · `CONSULTANT_NAME` · `SERVICE_AREA` · `DEFAULT_TIMEZONE`

Do **not** set `SUPABASE_DB_URL` or `SUPABASE_DB_PASSWORD` — they are only used for migrations.

### Frontend

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | Next.js |

Environment variables: `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` ·
`NEXT_PUBLIC_API_BASE_URL` (your deployed backend URL) · `NEXT_PUBLIC_SITE_URL`

### Self-contained by design

Each folder deploys independently. The knowledge documents are **compiled into**
`backend/src/knowledge/generated/documents.ts` rather than read from `docs/` at runtime — Vercel
only ships the project root, so a runtime read of `../docs/` would work locally and 404 in
production. After editing any file in `docs/knowledge/`, run:

```bash
pnpm --filter backend knowledge:build
```

and commit the regenerated module.

## Routes

| Path | What |
| --- | --- |
| `/call` | The voice widget — consent gate, mic, live transcript |
| `/dashboard` | Lead list, scores, pipeline stats, top objections |
| `/dashboard/leads/[id]` | Customer profile, qualification data, transcript |
| `/dashboard/login` | Admin sign-in (no public signup) |

## Creating the first admin

The dashboard has no signup form by design. In the Supabase dashboard:

1. Authentication → Users → **Add user** (email + password)
2. SQL Editor:

```sql
insert into profiles (id, email, role, is_active)
values ('<the-new-user-uuid>', '<their-email>', 'admin', true);
```

A user in `auth.users` without a `profiles` row can sign in but reads nothing — RLS sees them as
anonymous.
