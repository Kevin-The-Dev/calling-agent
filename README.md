# AI Voice Cold Calling Sales Agent

A real-time AI appointment setter for residential solar. It speaks with homeowners in the browser,
qualifies them against the sales methodology, handles objections, collects their contact details,
books consultations, and stores everything in Supabase.

It is built to be heard as a **person on a phone**, not as a chatbot — see
[How it stays human](#how-it-stays-human).

**Status:** Working end to end. A visitor can hold a spoken conversation with the agent, be
qualified against the sales methodology, and land in the CRM as a scored lead. Milestone detail and
what remains is in [implementation.md](implementation.md).

---

## Contents

1. [Quick start](#quick-start)
2. [Configuration](#configuration)
3. [Database](#database)
4. [Admin login — creating your first account](#admin-login--creating-your-first-account)
5. [How to use it](#how-to-use-it)
6. [How it stays human](#how-it-stays-human)
7. [What the agent collects](#what-the-agent-collects)
8. [Layout](#layout)
9. [Scripts](#scripts)
10. [Deploying to Vercel](#deploying-to-vercel)
11. [Troubleshooting](#troubleshooting)
12. [Documentation](#documentation)

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

Then open **http://localhost:3000/call**, allow the microphone, and press **Start call**. The agent
speaks first, exactly as a real setter would.

> **Browser support:** Chrome, Edge, or Safari. Firefox has no Web Speech API and the app will say
> so rather than sit silent. The page must be on `localhost` or HTTPS — browsers refuse microphone
> access otherwise.

---

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

**Identity — the agent says these out loud.** Leave one blank and it will refuse to invent a value,
which is correct but sounds evasive on a live call.

| Variable | Spoken as |
| --- | --- |
| `COMPANY_NAME` | "I'm with …" |
| `AGENT_NAME` | "This is …" |
| `CONSULTANT_NAME` | The engineer who visits. Blank → "one of our engineers" |
| `SERVICE_AREA` | "we're working right in the corner of your neighborhood" |
| `DEFAULT_TIMEZONE` | Anchors the appointment dates the agent offers |

The backend validates all of it at startup and refuses to run on a bad config, listing every problem
at once. Secrets are never printed — the boot banner reports them as `set`/`unset`.

> **Never** put `SUPABASE_SERVICE_ROLE_KEY` or any LLM key in `frontend/.env.local`. Everything
> prefixed `NEXT_PUBLIC_` is compiled into the browser bundle and is publicly readable.

---

## Database

21 migrations in `supabase/migrations/`, each idempotent and safe to re-run.

> Already have a database from before? Run `021_calls_appointment.sql` — it adds the two columns
> that carry the agreed appointment through a call. Without it the backend cannot read or write a
> booking.

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

---

## Admin login — creating your first account

The dashboard is **invite-only**. There is deliberately no signup form (claude.md §10), so the first
account is created by hand. This takes two steps, and **both are required** — an `auth.users` record
without a `profiles` row can sign in but will see an empty dashboard, because RLS treats it as
anonymous.

### Step 1 — create the auth user

In the Supabase dashboard:

**Authentication → Users → Add user → Create new user**

- Email: the address you will sign in with
- Password: set one now
- ✅ **Auto Confirm User** — without this the account cannot sign in until the email is verified

Copy the **UID** shown in the user list. You need it for step 2.

### Step 2 — grant dashboard access

**SQL Editor → New query**, then run:

```sql
insert into profiles (id, email, full_name, role, is_active)
values (
  '00000000-0000-0000-0000-000000000000',  -- ← paste the UID from step 1
  'you@example.com',                        -- ← same email as step 1
  'Your Name',
  'admin',                                  -- 'admin' or 'viewer'
  true
);
```

| Role | Can do |
| --- | --- |
| `admin` | Full read access to leads, calls, transcripts, recordings, and analytics |
| `viewer` | Read-only, same views — use for staff who should not change settings |

### Step 3 — sign in

Go to **`/dashboard/login`** (locally: http://localhost:3000/dashboard/login) and use the email and
password from step 1.

### Adding more people later

Repeat both steps for each person. To revoke access without deleting anything:

```sql
update profiles set is_active = false where email = 'someone@example.com';
```

### If sign-in does not work

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Invalid login credentials" | User not confirmed | Supabase → Authentication → Users → ⋯ → Confirm email |
| Signs in, dashboard is empty | No `profiles` row, or the UID does not match | Re-run step 2 with the exact UID |
| Bounced straight back to `/dashboard/login` | `NEXT_PUBLIC_SUPABASE_*` missing or wrong | Check `frontend/.env.local`, restart `pnpm dev` |

---

## How to use it

### Taking a call

1. Open **`/call`** (or the widget on the landing page).
2. Press **Start call** and allow the microphone. Consent is recorded before anything is captured —
   the backend rejects a call that starts without it.
3. **The agent speaks first.** Just talk back normally; there is no push-to-talk. It detects when
   you stop speaking (~650ms) and answers.
4. You can **interrupt it** — start talking over the agent and it stops mid-sentence, the way a
   person would.
5. Press **End call** when you're done. The transcript, the lead, a generated summary, and the audio
   recording are all written to Supabase.

The agent works through the sales process in order and cannot skip ahead: opening → reason for the
call → qualification → need discovery → the bill swap → booking → locking the appointment → recap.
Objections interrupt wherever they land and it returns to where it left off.

Two of those beats are statements rather than questions, and the state machine will not let the
conversation past them until they have actually been said. It cannot leave the reason-for-the-call
beat until **SGIP** has been named out loud, and it cannot start booking until the **bill swap** has
been delivered with the prospect's real numbers. A question the agent forgets to ask leaves a hole
in the lead record that the completeness gate catches; a statement it forgets to make leaves no
trace at all, which is why both are read back off what was spoken
(`backend/src/agents/beats.ts`). Without those gates the agent would ask about the letter, move on,
and interrogate someone about their electricity bill who had never been told why.

### Reading the results

| Page | What's there |
| --- | --- |
| `/dashboard` | Pipeline stats, scores, outcomes, the objections that come up most |
| `/dashboard/leads` | Every lead, searchable by name, phone, address, or email |
| `/dashboard/leads/[id]` | One customer: contact details, qualification answers, objections raised, the full transcript, and the call recording synced to it |
| `/dashboard/calls` | Every call with its stage, outcome, and latency |

Playing a recording highlights the transcript line being spoken.

### Trying a call without a microphone

`POST` straight to the API — useful for testing the sales logic quickly:

```bash
# 1. start a call
curl -s -X POST http://localhost:8787/api/calls \
  -H 'Content-Type: application/json' \
  -d '{"consent":true}'
# → {"callId":"…","token":"…"}

# 2. let the agent open
curl -N -X POST http://localhost:8787/api/calls/<callId>/turn \
  -H 'Content-Type: application/json' -H 'X-Call-Token: <token>' \
  -d '{"utterance":"__call_started__"}'

# 3. reply as the prospect
curl -N -X POST http://localhost:8787/api/calls/<callId>/turn \
  -H 'Content-Type: application/json' -H 'X-Call-Token: <token>' \
  -d '{"utterance":"Yeah, this is Dave. I own the place."}'

# 4. finish
curl -X POST http://localhost:8787/api/calls/<callId>/end \
  -H 'X-Call-Token: <token>'
```

---

## How it stays human

A prospect decides within about three seconds whether they are talking to a person, and once they
decide it is software the call is over. Six things defend that:

- **The opening line is written, not generated.** It is the one line that has to be right and the
  one turn with nothing to mask its latency, so it is not left to a model. Left to one it drifted
  into "Hi there, sorry to bother you, is this a good time to chat for a moment?", which is an
  apology, a request for permission and the word "chat" in a single breath. The real opener greets,
  says who is calling, establishes that there is a crew working right in the corner of the
  neighbourhood for the next couple of weeks, and asks who it is speaking with. It never apologises
  for calling and it never asks to be allowed to continue. See `backend/src/agents/opening.ts`.
- **Chat-window vocabulary is rewritten before it is spoken.** "Chat" becomes "talk", and
  permission-asking openers ("is this a good time", "do you have a minute", "sorry to bother you")
  are dropped whole. Nobody working a street asks for an audience.
- **It reacts before it asks.** Every turn acknowledges what was just said before moving on. A reply
  that is nothing but a question is an interrogation, and it is the loudest tell there is.
- **One question per turn, always** — enforced in code, not just asked for in the prompt. A reply
  containing two questions is truncated to the first before it is spoken.
- **Assistant phrasing is stripped before it reaches the speaker.** "I'd be happy to help with
  that", "Is there anything else I can assist you with", "Certainly" — none of it is a lie, which is
  why prompting alone never removes it, and all of it is instantly recognisable as a machine.
  `backend/src/agents/guardrails.ts` deletes it and speaks the rest.
- **It speaks like speech.** Contractions, uneven sentence lengths, spoken numbers ("about two forty
  a month", never "$240.00"), varied openers, and the prospect's first name at a natural beat rather
  than in every turn.

It will **not** pretend to be human if asked directly — it answers honestly and briefly, then
carries on. That is a deliberate line: sounding natural is not the same as lying about what it is.

The same layer also blocks what it must never say: promises of approval, specific dollar savings, a
free roof, full funding, invented utility partnerships, or any reference to a script, prompt, or
internal process. A blocked reply falls back to "I'm not 100% sure about that, and I'd rather not
give you incorrect information" rather than guessing.

---

## What the agent collects

The agent starts every call knowing **nothing** — no name, no address, no phone number. It asks for
each one out loud, one at a time, at the point in the conversation where a real setter would.

| Detail | When it's asked |
| --- | --- |
| Name | Opening — "who am I speaking with?" |
| Homeowner | Opening, before anything else is discussed |
| Monthly electricity bill | Qualification |
| Home type & roof ownership | Qualification |
| **Property address** | Qualification — so the engineer goes to the right home |
| Credit band (650+) | Qualification |
| Shading | Qualification |
| Utility provider | Qualification |
| Decision makers | Before any time is proposed |
| **Appointment date & time** | Booking — the agent is given the real calendar and may only offer tomorrow through two weeks out |
| **Phone number** | Locking the appointment — read back once to confirm |
| **Email** | Locking the appointment — optional, never pushed twice |

These are server-side gates in `backend/src/agents/state-machine.ts`, not suggestions to the model:

- Qualification cannot be left until name, address, homeowner status, home type, roof ownership,
  bill, provider, and credit band are all known.
- A time cannot be proposed until decision makers are identified.
- The closing recap cannot start until a slot has been agreed **and** a phone number captured.

Everything lands on the `leads` row and is searchable from the dashboard. The agreed slot is written
to `appointments`, and the database itself refuses to mark one `booked` until all five §8 recap
reminders were actually spoken — an appointment where they were not comes out as `held`, meaning a
human should follow up. A call is only recorded as `booked` when a real appointment row backs it.

---

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

### The interface

Every colour, shadow, radius and easing is a token in `frontend/app/globals.css`. Nothing in a
component hardcodes a hex, which is what makes the light and dark palettes a single block of
overrides rather than a `dark:` variant on every element. The palette is one accent (signal blue) on
cool neutrals; the four other colours carry live call state (listening, thinking, speaking, failed)
and appear nowhere that is not reporting one of those, plus a green reserved for a booked
appointment. Type is Geist throughout with Geist Mono for anything that changes in place. Icons are
Phosphor, one weight.

The design rules the redesign was audited against are vendored in
`.claude/skills/design-taste-frontend` and `.claude/skills/redesign-existing-projects`.

---

## Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Run both apps |
| `pnpm verify` | typecheck + lint + test — run before every commit |
| `pnpm typecheck` | Strict TS across both packages |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (backend) |
| `pnpm db:bundle` | Regenerate `supabase/bundle.sql` |
| `pnpm --filter backend knowledge:build` | Recompile `docs/knowledge/` into the backend bundle |

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
| Node.js Version | 20.x or later |
| **Include source files outside of the Root Directory** | **On** |

That last one is not optional: `backend/tsconfig.json` extends `../tsconfig.base.json` and the pnpm
workspace manifest lives at the repository root. With it off, install and typecheck both fail.

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

Deploy the backend first — the frontend needs its URL, and the backend needs the frontend's URL in
`ALLOWED_ORIGINS`. Set that on the backend once both exist and redeploy it.

### Self-contained by design

Each folder deploys independently. The knowledge documents are **compiled into**
`backend/src/knowledge/generated/documents.ts` rather than read from `docs/` at runtime — Vercel only
ships the project root, so a runtime read of `../docs/` would work locally and 404 in production.
After editing any file in `docs/knowledge/`, run:

```bash
pnpm --filter backend knowledge:build
```

and commit the regenerated module.

---

## Troubleshooting

### `Error: Function Runtimes must have a valid version, for example now-php@1.0.0`

The `functions` block in `vercel.json` had an explicit `"runtime": "nodejs20.x"`. That key is for
**community** runtimes and needs a package name with a version; the built-in Node runtime is
inferred and must not be named there. `backend/vercel.json` no longer sets it — the Node version
comes from `engines.node` in `backend/package.json` and the project's Node.js Version setting.

### The agent never responds / goes silent mid-call

Open the browser console. If the microphone indicator is still on but nothing is transcribed, the
speech engine dropped an `onend` event — `frontend/voice/speech.ts` has a watchdog that recovers
from this within a few seconds. If it persists, reload; browser speech synthesis is the least
reliable part of the stack (implementation.md R8, R13).

### The agent keeps asking the same question

It is missing a field it cannot progress without. Check the call's stage in
`/dashboard/calls` against the gates in [What the agent collects](#what-the-agent-collects).

### CORS errors from the deployed frontend

`ALLOWED_ORIGINS` on the backend must contain the frontend's exact origin, scheme included, no
trailing slash. Preview deployments have different URLs than production.

### `curl /api/ready` returns unhealthy

It pings Supabase and the LLM. The response body names which one failed.

---

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

---

## Before this handles a real call

- [ ] **Rotate every key that was ever in a committed `backend/.env`** — see the security note below
- [ ] Real identity values in `backend/.env` — the agent speaks them aloud
- [ ] Compliance review of the sales script (implementation.md R1, R2)
- [ ] Decide R14 — the LLM key is a coding-plan subscription
- [ ] Decide R15 — the LLM is China-hosted, and leads are US homeowner data
- [ ] Answer Q7 — the recap promises a confirmation text the system does not send
- [ ] Decide on server-side TTS — until then, recordings capture the prospect only (see below)

### Recordings capture one side of the call

`recordings.channels` is `prospect`, and that is what the audio contains. The agent speaks through
the browser's `speechSynthesis`, and no browser routes synthesized audio into Web Audio or an
output capture, so there is nothing to mix its voice in from. The agent's side of every call is in
the transcript, time-aligned to the recording, but not in the audio file.

The fix is to move to a real TTS provider (`TTS_PROVIDER=elevenlabs` is already scaffolded in
`backend/src/lib/env.ts`). Its output is an actual `MediaStream`, which can be mixed with the
microphone into a single two-sided recording — and it sounds markedly more human than the browser
voices. It needs an API key and is the one remaining piece of the voice stack that costs money.

> ### ⚠️ Security note
>
> `backend/.env` was committed in the first commit and pushed to GitHub. `.gitignore` does not
> apply to files git is already tracking. It has since been untracked, but **the history still
> contains it** — treat every credential that has ever been in that file as public and rotate it:
> the LLM API keys, `SUPABASE_SERVICE_ROLE_KEY`, and `CALL_TOKEN_SECRET`.
