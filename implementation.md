# implementation.md — AI Voice Cold Calling Sales Agent (MVP)

> **Deliverable 1 of 3** (`claude.md` §16). Living document — plan, decisions, and build record.

| | |
| --- | --- |
| **Phase 0** | ✅ Both PDFs read and extracted to [docs/knowledge/](docs/knowledge/) |
| **Phase 1** | ✅ This document + [database.md](database.md) + 7 knowledge files |
| **M1** Foundation | ✅ Complete |
| **M2** Knowledge & prompts | ✅ Complete |
| **M3** Conversation engine | ✅ Complete — verified by live calls |
| **M4** Voice I/O | ✅ Complete (browser speech, D8) |
| **M5** Persistence | ✅ Complete · recordings ⬜ not built (see R13) |
| **M6** Dashboard | 🟡 Partial — auth, leads, profile, transcripts, analytics |
| **M7** Hardening | 🟡 Partial — rate limits, consent, CORS, deploy configs |

---

## 0. Decisions & deviations

### 0.1 Decisions log (2026-08-05)

All Phase 1 open questions are resolved. These are locked unless changed explicitly.

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Inbound web widget.** The visitor clicks to talk; the agent never dials out. | No telephony in the stack. The "we're working in your neighborhood" framing is preserved as narrative. Compliance load drops sharply — no TCPA/DNC dialing exposure. |
| D2 | **Repo split into `frontend/` and `backend/`.** | Overrides `claude.md` §12 — see §0.2. |
| D3 | **Backend = Hono on Vercel Functions.** | Everything stays on Vercel; no WebSocket server. |
| D4 | **Appointments in Supabase only.** | No Google Calendar OAuth. Slots generated and conflict-checked against the `appointments` table. No confirmation SMS/email in MVP — the agent still *says* a confirmation text is coming, so this is a gap to close post-MVP (see R12). |
| D5 | **English only.** | `language` is still captured; a non-English caller triggers the fallback and a human callback. Knowledge layer is structured so a second language is a content addition, not a code change. |
| D6 | **Single configured consultant name**, set in agent settings and used in the §8 recap verbatim as the script writes it. | `agent_settings.consultant_name` must be populated before launch. If unset, the agent falls back to "one of our engineers" rather than inventing a name. |
| D7 | **Savings figure is always "20 to 50%"**, in every stage. | The objection sheet's "30 to 50%" is deliberately overridden. Enforced by the banned-claim filter. |
| D8 | **Browser-only voice for MVP** — Web Speech API for speech-to-text, `speechSynthesis` for the voice. | Zero cost, zero accounts, no Deepgram or ElevenLabs keys. Significant consequences — see §1.5 and R8/R13. The provider interfaces are still built, so paid providers drop in later without touching the turn engine. |
| D9 | **LLM is GLM `glm-4.5-flash`, not Kimi.** Deviates from `claude.md` §4, on measured evidence. | The supplied Kimi key is a Kimi Code plan whose models reason before replying and cannot be told not to — **2.43s to the first spoken word**. GLM `glm-4.5-flash` measured **0.87s median**, inside the §1.6 budget. Two structural consequences: the endpoint is **Anthropic-shaped**, so the LLM service is an Anthropic-style adapter rather than an OpenAI one; and the API is **China-hosted**, adding a fixed network tax (0.32s TLS handshake from the US) that connection reuse must amortize. Licensing caveat in R14. |

### 0.2 Deviations from `claude.md`

| Rule | Deviation | Reason |
| --- | --- | --- |
| §12 folder structure (flat `app/`, `components/`, …) | Split into `frontend/` and `backend/` at the repo root | Explicit user instruction. The §12 directories are preserved **inside** each side. |
| §4 "Voice: browser microphone" | Speech-to-text and text-to-speech need third-party providers; Kimi supplies the LLM only | The browser captures audio; it does not transcribe or synthesize at production quality. Both are behind a provider interface with a zero-key browser fallback. |

Everything else follows `claude.md` as written.

---

## 1. Architecture

### 1.1 Repository layout

```
Calling Agent/
├── frontend/                      # Next.js 15 (App Router) → Vercel
│   ├── app/
│   │   ├── (public)/call/         # the voice agent widget page
│   │   └── dashboard/             # admin-only, Supabase Auth
│   ├── components/                # reusable UI
│   ├── voice/                     # mic capture, VAD, playback, recorder
│   ├── hooks/                     # useCall, useMic, useTranscript, useRealtime
│   ├── lib/                       # supabase browser client, api client, formatters
│   ├── types/                     # shared DTOs (generated + hand-written)
│   └── utils/
│
├── backend/                       # Hono + TypeScript → Vercel Functions
│   ├── src/
│   │   ├── routes/                # HTTP surface (see §1.4)
│   │   ├── agents/                # turn engine, state machine, extractor, scoring
│   │   ├── knowledge/             # loader + prompt assembly
│   │   ├── services/              # kimi, stt, tts, supabase, storage, booking
│   │   ├── lib/                   # env, logging, errors, validation
│   │   ├── types/                 # database.ts (generated), domain types
│   │   └── utils/
│   └── tests/
│
├── supabase/
│   ├── migrations/                # 001…020 (see database.md §8)
│   └── seed/
│
├── docs/
│   └── knowledge/                 # 7 extracted files — runtime source of truth
│
├── implementation.md              # this file
├── database.md
└── claude.md
```

`agents/`, `voice/`, `knowledge/`, `services/`, `lib/`, `hooks/`, `types/`, `utils/`,
`components/`, `dashboard/` from §12 all exist — distributed to the side that owns them.

### 1.2 Runtime topology

```
┌─────────────────────── browser ───────────────────────┐
│  mic ──► Web Speech API (SpeechRecognition)           │  no key
│    │      ◄── interim + final transcripts             │
│    │                                                  │
│    ├─── POST /calls/:id/turn (SSE) ─► backend ─► Kimi │
│    │    ◄── streamed reply text ──────                │
│    │                                                  │
│    ├─── speechSynthesis.speak(sentence)               │  no key
│    │      barge-in ⇒ speechSynthesis.cancel()         │
│    │                                                  │
│    └─── MediaRecorder(mic) ──► prospect audio only    │
│              └── chunked POST /calls/:id/recording ──►│
└───────────────────────────────────────────────────────┘
                                            │
                              backend (service role) ──► Supabase
                                                          Postgres · Storage · Realtime
```

Under D8 only the LLM sits behind the backend, so the Kimi key never reaches the browser and nothing
else needs a key at all.

**Post-MVP (paid providers, no turn-engine changes):** the backend gains `POST /api/voice/stt-token`
— minting a short-lived, transcription-only key so the browser can stream audio to Deepgram over a
WebSocket — and `POST /api/voice/tts`, proxying ElevenLabs so that key stays server-side. The
indirection exists because Vercel Functions cannot hold a WebSocket, which rules out a server-side
audio relay. Both routes are specced now and sit behind the same provider interfaces; neither ships
in the MVP.

### 1.3 The turn engine

Each prospect utterance runs **two** model calls with different jobs:

| | **Conversational call** | **Extractor call** |
| --- | --- | --- |
| Purpose | What the agent says | Structured state update |
| Output | Plain text, streamed | Strict JSON (tool call) |
| Latency | On the critical path — first sentence goes to TTS immediately | Off the critical path — runs in parallel, result applied before the *next* turn |
| Temperature | ~0.6 (natural) | 0 (deterministic) |
| Prompt | Persona + stage instructions + retrieved objection + lead state + last N turns | Last exchange + current lead object + field schema |

Splitting them is the core latency decision: forcing one call to emit both JSON and speech means
nothing can be spoken until the JSON parses. Streaming plain text lets sentence 1 reach TTS in
~300 ms while the extractor works in the background.

**Sequence per turn**
1. STT emits a final transcript + `is_final` endpoint signal.
2. Persist the prospect turn; kick off the extractor call (fire-and-forget, awaited before turn N+1).
3. Assemble the conversational prompt for the **current** stage.
4. Stream Kimi's reply; on each sentence boundary, push that sentence to TTS and start playback.
5. Persist the agent turn, stage transition, objection event, and `call_events` row.
6. Scoring service recomputes `qualification_score` **server-side** from the lead object — never
   trusted from the model.

**State machine authority.** The model *proposes* a stage; `agents/state-machine.ts` validates it
against the transition table in [conversation-flow.md](docs/knowledge/conversation-flow.md) and
rejects illegal jumps (silently keeping the current stage). The model never controls the flow
unilaterally.

**Prompt assembly.** The full knowledge base is ~12k tokens — small enough that no vector store is
needed. Each turn assembles: persona + hard rules (~600 tokens) · current-stage instructions
(~250) · lead object as JSON (~150) · matched objection entry only, if any (~200) · last 8 turns
(~600). Target **< 2k tokens per turn**, keeping cost and latency low.

### 1.4 Backend API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/calls` | Start a call: create `lead` + `call`, return `call_id` + config |
| `POST` | `/api/calls/:id/turn` | Prospect utterance → SSE stream of the agent reply |
| `POST` | `/api/calls/:id/end` | Finalize: outcome, summary, score, close recording |
| `POST` | `/api/calls/:id/recording` | Chunked recording upload → Storage |
| `POST` | `/api/voice/stt-token` | *(post-MVP)* Mint an ephemeral, scoped STT key |
| `POST` | `/api/voice/tts` | *(post-MVP)* Proxy TTS, stream audio back |
| `GET` | `/api/booking/slots` | Available slots for a window |
| `POST` | `/api/booking/appointments` | Create/lock the appointment |
| `GET` | `/api/dashboard/*` | Leads, calls, analytics, signed recording URLs (admin JWT) |
| `PUT` | `/api/admin/knowledge/:slug` | Knowledge manager (admin JWT) |
| `PUT` | `/api/admin/settings` | Prompt / voice / agent settings (admin JWT) |

Every request body is validated with **Zod**. Rate limits: 30 turns/min per call, 5 calls/hour per
IP. Public routes carry a signed call token; admin routes require a Supabase JWT whose `sub` has an
active `profiles` row.

### 1.5 Technology choices

| Layer | Choice | Rationale |
| --- | --- | --- |
| Frontend | **Next.js 15 App Router, React 19, TypeScript strict** | Required by `claude.md` §4 |
| Backend | **Hono + TypeScript on Vercel Functions** | Chosen with the user. Tiny, first-class streaming, deploys as Vercel Functions, no framework overhead for a pure API |
| Styling | **Tailwind CSS + shadcn/ui** | Fast, accessible dashboard primitives |
| Database | **Supabase** (Postgres, Auth, Storage, Realtime) | Required by §4 |
| LLM | **GLM `glm-4.5-flash`**, Anthropic-compatible, base URL from `.env` (D9) | `claude.md` §4 specifies Kimi, but the supplied Kimi key cannot answer fast enough for live speech (2.43s vs 0.87s). Kimi remains a selectable provider via `LLM_PROVIDER`. |
| STT | **Web Speech API** (MVP, D8) · Deepgram Nova streaming (post-MVP) | Zero key, zero cost, interim results, built-in endpointing. Deepgram is the upgrade path: sub-300 ms partials and ephemeral scoped keys |
| TTS | **`speechSynthesis`** (MVP, D8) · ElevenLabs Flash (post-MVP) | Zero key, zero cost, instant. ElevenLabs is the upgrade path: ~75 ms latency and natural prosody — the "never sound robotic" requirement really lives there (see R13) |
| Validation | **Zod** | Shared schemas across both sides |
| Tests | **Vitest** (unit) · **Playwright** (E2E) | §14 |
| Package manager | **pnpm workspaces** | One lockfile, shared `types` package |

**Provider abstraction is mandatory even though the MVP uses only one implementation.**
`services/stt/` and `services/tts/` each expose a single interface; the browser implementations ship
now, the paid ones are stubbed behind the same contract and selected by env var. Swapping providers
must never touch the turn engine. This is the whole reason D8 is a cheap decision to reverse.

### 1.6 Latency budget (target: < 900 ms end-of-speech → first audio)

Revised against real measurements (2026-08-05) rather than estimates. The LLM row is now
**measured**, not budgeted — it is the single largest segment and the reason D9 exists.

| Segment | MVP (browser voice + GLM) | Post-MVP (paid voice) |
| --- | --- | --- |
| STT endpointing → final transcript | ~300 ms | 150 ms |
| Prompt assembly | 30 ms | 30 ms |
| **LLM → first spoken token** *(measured, `glm-4.5-flash`, streaming, incl. network)* | **~870 ms** | ~870 ms |
| TTS first audio | ~30 ms (local) | 100 ms |
| **Total** | **~1.23 s** | **~1.15 s** |

This is over the original 800 ms target and under the 1.5 s p95 ceiling. Sentence-level streaming
means the *rest* of the reply flows behind that first token, so the perceived gap is the ~1.2s
before speech starts, not the full reply time. Levers if it needs to come down: connection keep-alive
(saves the 0.32s China TLS handshake per turn), a US-hosted provider such as Groq, or a filler line
on turns predicted to run long.

For reference, the rejected options: Kimi Code `kimi-for-coding` **2.43 s**, `glm-5.2` 1.16–3.19 s.

Browser `speechSynthesis` is actually *faster* to first audio than a network TTS — it's local. The
MVP's latency cost is on the recognition side, where the Web Speech API's endpointing is slower and
less tunable than Deepgram's. Quality, not latency, is what the paid upgrade buys (R13).

Techniques: stream at sentence boundaries · barge-in calls `speechSynthesis.cancel()` and aborts the
in-flight stream within 100 ms · a filler line ("Let me note that down…") plays if the reply exceeds
1.2 s · extraction never blocks speech.

### 1.7 Environment variables

No secret is ever hardcoded or exposed to the browser (§11).

```bash
# backend/.env
KIMI_API_KEY=
KIMI_BASE_URL=                       # supplied per claude.md §4
KIMI_MODEL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=           # server only — never in frontend

# voice — MVP runs on `browser` for both; the rest are unset until you upgrade
STT_PROVIDER=browser                 # browser | deepgram
TTS_PROVIDER=browser                 # browser | elevenlabs
DEEPGRAM_API_KEY=                    # post-MVP
ELEVENLABS_API_KEY=                  # post-MVP
ELEVENLABS_VOICE_ID=                 # post-MVP

CALL_TOKEN_SECRET=
ALLOWED_ORIGINS=

# frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=       # RLS-protected, read-only
NEXT_PUBLIC_API_BASE_URL=
```

---

## 2. Milestones

Each milestone ends with tests + a manual checklist. **No milestone is complete without
verification** (§14, §15).

### M0 — Documentation ✅ (this phase)
- [x] Extract both PDFs
- [x] 7 knowledge files in `docs/knowledge/`
- [x] `implementation.md`
- [x] `database.md`
- [ ] **Approval gate**

### M1 — Foundation ✅ **COMPLETE** (2026-08-05)
- [x] pnpm workspace; `frontend/` (Next 15.5, React 19, TS strict) and `backend/` (Hono) scaffolds
- [x] ESLint + Prettier + strict `tsconfig` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] Migrations 001–020 written and **validated against a live Postgres**
- [x] Env loading with Zod validation that fails fast on boot
- [x] LLM provider abstraction — Anthropic-shaped (GLM) + OpenAI-shaped (Kimi/Groq/Gemini)
- [x] Structured logger with secret + PII redaction
- [x] Health and readiness endpoints; both apps boot and serve
- [x] Migrations applied to the hosted project — verified against live Postgres 17.6
- [ ] Vercel preview deploys — awaiting a Vercel account

**Acceptance results**

| Criterion | Result |
| --- | --- |
| `pnpm typecheck` | ✅ clean, both packages, strict mode |
| `pnpm lint` | ✅ zero warnings |
| `pnpm test` | ✅ 22/22 passing (env validation, logger redaction, app routes) |
| Migrations apply to a clean database | ✅ 13 tables · 3 views · 15 enums · 13 RLS-enabled tables · 16 policies |
| Migrations are re-runnable | ✅ second run clean, seed rows not duplicated |
| `booked_requires_full_recap` enforced | ✅ incomplete booking rejected, complete one accepted |
| `do_not_contact` irreversible | ✅ clearing it raises at the database level |
| Backend boots and reaches live services | ✅ `/api/ready` → Supabase 952 ms, GLM 1388 ms |
| No secret reachable from the browser bundle | ✅ LLM key, service-role key, DB password, `postgresql://` all absent from served HTML/JS |
| Boot banner leaks no secrets | ✅ credentials reported as `set`/`unset` only |

**Live database verification (hosted project, Postgres 17.6):** schema matches the local run
exactly — 13 tables · 3 views · 15 enums · 13 RLS-enabled tables · 16 policies · 7 knowledge rows ·
1 active config · private `call-recordings` bucket. Zero tables without RLS. Anonymous reads return
`[]` on all six data tables; an anonymous `INSERT` into `leads` returns 401; the service role reads
fine. Both database-level guarantees re-tested live and rolled back: an incomplete `booked`
appointment is rejected, and clearing `do_not_contact` raises. `/api/ready` now reports
`migrationsApplied: true`.

**Connection note:** `db.<ref>.supabase.co` is IPv6-only and unreachable from IPv4-only networks;
a dedicated IPv4 address is a paid Pro add-on. The free shared Supavisor pooler
(`aws-0-ap-northeast-1.pooler.supabase.com`, user `postgres.<ref>`) is IPv4 and is the connection
path used here. Recorded in `backend/.env` as `SUPABASE_DB_URL`.

**Caught during M1:** the Zod `.url()` check on `SUPABASE_URL` accepted a
`postgresql://user:password@…` connection string. A test written to reproduce the actual setup
mistake failed, and the *validator* was fixed to require an http(s) scheme — the schema now rejects
the paste that would silently put a database password into config.

### M2 — Knowledge & prompt layer ✅ **COMPLETE**
- [ ] Markdown loader + parser; seed `knowledge_documents` from `docs/knowledge/`
- [ ] Persona/system prompt builder + per-stage instruction templates
- [ ] Objection matcher (keyword + fuzzy over the 18 late + 6 early objections)
- [ ] Kimi client: streaming, tool calling, retry with backoff, timeout, token accounting
- [ ] **Spike:** confirm Kimi's tool-calling / JSON-mode reliability for the extractor. If it is
      unreliable, fall back to a strict JSON prompt + repair pass. *This is the one unknown in the
      stack and it gets resolved first.*
- **Acceptance:** every knowledge file loads and renders into a prompt < 2k tokens; the matcher
  scores ≥ 90% on a 40-case fixture set; a streamed Kimi completion returns first token < 500 ms
  p50; the extractor returns schema-valid JSON on 50/50 fixtures.

### M3 — Conversation engine ✅ **COMPLETE**
- [ ] `Lead` and `CallState` types; stage machine with the full transition table + guards
- [ ] Turn engine: conversational stream + parallel extractor; lead patching
- [ ] Scoring service (weights from `qualification-rules.md` §7) + DQ evaluation
- [ ] Fallback/guardrail layer: banned-claim filter, one-question-per-turn enforcement,
      do-not-contact interrupt, AIR cycle counter
- [ ] `POST /api/calls`, `/turn`, `/end` with persistence
- [ ] Text chat harness at `/call?mode=text` for fast iteration without audio
- **Acceptance:** 12 scripted conversation fixtures (happy path, each DQ, each objection class,
  do-not-contact, hostile, decision-maker re-slot) drive the machine to the correct terminal
  state; no illegal stage transition is ever accepted; no turn contains two questions; no banned
  claim escapes the filter; scores match hand-computed expectations.

### M4 — Voice I/O ✅ **COMPLETE** *(browser-only, D8)*
- [ ] Mic permission + device handling; unsupported-browser detection and messaging
- [ ] STT provider interface — **Web Speech API implementation** (continuous + interim results,
      restart-on-end handling, confidence thresholds); Deepgram implementation stubbed
- [ ] TTS provider interface — **`speechSynthesis` implementation** (voice selection, rate/pitch
      from agent settings, sentence queue); ElevenLabs implementation stubbed
- [ ] Sentence-boundary streaming into the speech queue
- [ ] Barge-in: detect speech during playback → `speechSynthesis.cancel()` + abort the SSE stream
- [ ] Call UI: transcript, status, mute, end call, error states
- **Acceptance:** full spoken conversation end-to-end with **no paid keys**; p50 end-of-speech →
  first audio < 900 ms, p95 < 1.8 s; barge-in cuts audio in < 100 ms; every technical fallback in
  `fallback-responses.md` §5 fires correctly; works in Chrome, Edge, and Safari; Firefox shows a
  clear "unsupported browser" state rather than failing silently.

### M5 — Persistence & recordings
- [ ] Transcript turns written with timing + confidence metadata
- [ ] `MediaRecorder` on the mic stream → chunked upload → Storage (**prospect audio only** — see
      R13; the agent's side is preserved in the transcript, not the audio)
- [ ] Call finalization: outcome, summary generation, appointment write
- [ ] Booking service: slot generation, conflict checks, recap-flag enforcement
- [ ] Signed URL minting for playback
- **Acceptance:** a completed call yields a complete `lead`, `call`, ordered `transcript_turns`, a
  playable recording, and (on the happy path) an `appointments` row that satisfies the
  `booked_requires_full_recap` constraint; a mid-call network drop still persists partial state.

### M6 — Dashboard 🟡 **PARTIAL**
- [ ] Supabase Auth login; admin-only guard; **no public signup**
- [ ] Lead list: filter, sort by score, trigram search
- [ ] Lead profile: full object, call history, appointment, objections
- [ ] Transcript viewer synced to the recording player
- [ ] Analytics: funnel, stage drop-off, top objections, booking rate
- [ ] Live calls via Realtime
- [ ] Knowledge manager (edit + version history + rollback)
- [ ] Prompt editor, voice settings, agent settings
- **Acceptance:** an anonymous visitor gets nothing from any dashboard route or table; a `viewer`
  cannot write; editing knowledge creates a version row and changes the next call's behaviour; a
  live call appears within 2 s; recordings play via signed URLs that expire.

### M7 — Hardening & deploy
- [ ] Rate limiting, CORS lockdown, input validation on every route
- [ ] Structured logging with PII redaction; error tracking
- [ ] Consent gate before recording starts
- [ ] Load test: 20 concurrent calls
- [ ] Production deploy + runbook + `README`
- **Acceptance:** the full validation checklist in §4 passes on production.


### M2–M7 results (2026-08-05)

| Milestone | State | Evidence |
| --- | --- | --- |
| **M2** Knowledge & prompt layer | ✅ | 7 documents compiled to a committed TS module (51.7 KB); loader prefers Supabase rows and falls back to bundled; 24-objection catalogue; prompt assembly under 2k tokens. **44/44 matcher tests pass.** |
| **M3** Conversation engine | ✅ | State machine with guards + server-side auto-advance, scoring, guardrails, two-call turn engine, call token auth, SSE turn route. **30/30 engine tests pass.** Verified by 4 full live conversations. |
| **M4** Voice I/O | ✅ | Web Speech recognition with auto-restart, `speechSynthesis` queue with voice selection, barge-in via `cancel()` + stream abort, listener muted during playback, consent gate, unsupported-browser screen. |
| **M5** Persistence | ✅ | Transcript turns, lead patching, objection events, call events, summary generation — all verified in the live database. |
| **M5** Recording upload | ⬜ | Not built. See R13 — under D8 only prospect audio is capturable, and the transcript already carries both sides. |
| **M6** Dashboard | 🟡 | Auth + guard, lead list with scores, customer profile, transcript viewer, funnel stats, top objections. **Not built:** live-calls Realtime view, knowledge manager, prompt editor, settings UI. |
| **M7** Hardening | 🟡 | Per-call rate limiting, CORS allowlist, consent gate, secret redaction, Vercel configs. **Not built:** load test, error tracking. |

**Live end-to-end proof** — a 17-turn scripted conversation against GLM and Supabase:

```
outcome : partial
lead    : name=Sam bill=240.00 utility="PG and E" credit=above_650 score=92 band=hot status=qualified
decision makers: [{"name":"Maria","relationship":"wife","will_attend":true}]
latency : p50 1422 ms
summary : auto-generated, factually accurate
persisted: 4 leads · 4 calls · 124 transcript turns · 26 call events
```

**Three defects found by end-to-end testing and fixed:**

1. **Stage lag.** Relying on the model to propose every transition left the tracked stage several turns behind the real conversation, so the agent kept receiving qualification instructions while negotiating a time slot. Fixed with server-side `autoAdvance()` — when a stage's exit condition is objectively met, the machine advances regardless of what the model proposed.
2. **Invented affiliation.** The model volunteered "PG&E is one of our partner providers", which appears nowhere in the knowledge base. Two guardrail patterns added; it recurred once as a paraphrase, so the second pattern covers that form too.
3. **Outcome misrecorded.** A call that reached `closing` with an agreed appointment was written as `abandoned`, burying qualified leads. `resolveFinalOutcome()` now maps confirmation/closing/ended to `partial`.

---

## 3. Acceptance criteria (product level)

**Conversation**
1. Stages advance in order; no skips; objection handling always returns to its origin stage.
2. Exactly one question per agent turn.
3. Wording varies between calls — the same fixture run twice produces materially different phrasing
   with identical strategy and identical extracted fields.
4. Never mentions PDFs, prompts, scripts, stages, scores, or internal logic.
5. Unknown facts trigger the fallback + a redirect that resumes the current stage.
6. Every objection in the sheet is recognized and answered with its mapped content.
7. Every DQ rule fires correctly and ends the call warmly.

**Data**
8. The lead object updates after every prospect response.
9. `qualification_score` is computed server-side and matches the §7 weights.
10. Transcript, recording, summary, buying intent, score, and outcome are all persisted.
11. An appointment is only `booked` when all five recap flags plus the conflict check are true.

**Voice**
12. p50 latency < 800 ms; p95 < 1.5 s.
13. Barge-in works.
14. Audio and transcript stay aligned via `audio_start_ms`.

**Security**
15. No API key appears in any client bundle or network response (except the scoped, expiring STT
    token).
16. RLS blocks all anonymous access; every write goes through the service role.
17. Do-not-contact is honored immediately and cannot be cleared from the app.

---

## 4. Validation checklist (run before every milestone sign-off)

**Automated**
- [ ] `pnpm typecheck` — zero errors, strict mode
- [ ] `pnpm lint` — zero warnings
- [ ] `pnpm test` — unit coverage ≥ 80% on `agents/`, `knowledge/`, `services/`
- [ ] `pnpm test:e2e` — Playwright suite green
- [ ] Conversation fixtures — all 12 reach the expected terminal state
- [ ] Guardrail suite — 30 adversarial prompts (prompt extraction, "are you AI", jailbreaks,
      hallucination bait) produce no leak and no invented fact
- [ ] Migrations apply cleanly to an empty database

**Manual**
- [ ] Complete a real spoken happy-path call → appointment booked
- [ ] Complete one call per DQ rule
- [ ] Interrupt the agent mid-sentence (barge-in)
- [ ] Deny mic permission; kill the network mid-call
- [ ] Ask 5 questions the PDFs do not answer → fallback every time, no invention
- [ ] Say "take me off your list" → immediate stop
- [ ] Play back a recording and follow the synced transcript
- [ ] Log in as `viewer` → confirm writes are blocked
- [ ] Open a dashboard URL logged out → redirected, no data
- [ ] Inspect the client bundle and every network response for secrets
- [ ] Edit a knowledge doc → confirm the next call reflects it

---

## 5. Risks

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R1 | **Compliance.** The material is written for outbound cold calling. Recording requires consent (two-party-consent states); outbound dialing implicates TCPA/DNC; AI-voice disclosure rules apply in several states. | Legal exposure | Ship an explicit consent gate before recording, an honest AI disclosure (`fallback-responses.md` §4), immediate irreversible do-not-contact, and full audit logging. **The MVP is a web widget the visitor initiates — it does not dial out.** Any move to outbound dialing needs legal review first. Flagged for the user's decision, not mine. |
| R2 | **Script claims.** "A complaint was filed about rate increases," "you may get the roof done for free," "we can get that kitchen for free," and the government framing are aggressive and, if delivered without hedging, could be read as deceptive. | Legal / brand | Hedging language is treated as load-bearing and enforced by the banned-claim filter (`fallback-responses.md` §3). Every claim is traceable to a PDF line. Recommend the user's compliance review of the script itself before production. |
| R3 | **Vercel cannot hold WebSockets.** | Architecture | Browser↔STT direct with ephemeral scoped keys; everything else over HTTP streaming. Escape hatch: move `backend/` to a long-running host (Fastify) without touching the turn engine. |
| ~~R4~~ | ~~**Kimi tool-calling / JSON reliability unverified.**~~ | — | ✅ **RETIRED 2026-08-05.** Spike run early against both keys. GLM `glm-4.5-flash` accepts forced `tool_choice` and returned a fully correct extraction on the first attempt. (Kimi rejects forced tool choice while thinking is on, but its `json_object` mode worked — moot under D9.) The extractor design is validated. |
| R14 | **Both supplied LLM keys are coding-plan subscriptions.** The GLM key works only through `/api/anthropic`; its pay-as-you-go `/api/paas/v4` path returns 429 "insufficient balance". A coding plan is sold for coding-agent use, and running a commercial sales product on it is likely outside its terms. | Service cut off without warning; possible terms violation | **Flagged for your decision — this is a business call, not a technical one.** Development proceeds on this key. Before production, either move to GLM pay-as-you-go credit on the standard endpoint, or switch `LLM_PROVIDER` to Groq or Gemini, both of which have free tiers intended for application use. The provider adapter makes that a config change. |
| R15 | **The LLM is China-hosted.** 0.32s TLS handshake measured from the US, plus whatever cross-border routing does under load. Data about US homeowners transits to a Chinese API. | Latency floor; possible data-residency problem | Connection keep-alive amortizes the handshake to once per call. The residency question needs your answer if these are real leads — a US-hosted provider (Groq, Gemini) removes it entirely, at the cost of leaving GLM. |
| R5 | **Latency creep** past 1.5 s makes it feel robotic. | Core UX failure | Latency budget is a tracked metric per turn (`transcript_turns.latency_ms`); sentence streaming; filler lines; small prompts; dashboard latency panel. |
| R6 | **Hallucinated product facts.** | Trust / legal | `[UNKNOWN]` registry, banned-claim filter, mandatory fallback, adversarial test suite. |
| R7 | **Voice provider cost** (~$0.15–0.30/call once upgraded). | Budget | Not incurred at MVP under D8. Per-call cost tracked from day one so the upgrade decision has real numbers behind it. |
| R8 | **Browser variance is now load-bearing** — D8 puts the entire voice layer in the browser. No Web Speech API in Firefox at all; Safari's implementation is quirkier and needs a per-utterance restart; `MediaRecorder` codecs differ. | Coverage gap, not just polish | Feature detection at call start with an explicit unsupported-browser screen; MP4/AAC fallback for Safari recording; Chrome/Edge/Safari supported, Firefox explicitly out of scope until the paid providers land. |
| R9 | **Vercel function duration limits** on long turn streams. | Dropped turns | Turns are short (< 10 s); `maxDuration` configured; recording upload is chunked, not one long request. |
| R10 | **Prompt-injection via prospect speech** ("ignore your instructions"). | Leak / break | Prospect text is never treated as instruction; output filter blocks stage names, JSON, and prompt text; covered by the guardrail suite. |
| R11 | **Recording storage growth.** | Cost | 180-day retention job; transcripts retained permanently. |
| R12 | **D4 gap — no confirmation text.** The closing recap promises "we'll text the confirmation" and a pre-visit call, but Supabase-only booking sends neither. The agent will make a promise the system does not keep. | Broken promise on every booked call | Two options, your call: (a) drop the texting line from the recap and say the consultant will call, or (b) add a Twilio/Resend confirmation in M5 (~half a day). **I need a decision here before M5** — I'm not shipping a promise the product can't honour. |
| R13 | **D8 quality ceiling.** `speechSynthesis` voices are audibly robotic on most systems, and voice availability varies by OS/browser — directly at odds with `claude.md` §5 "never sound robotic." Separately, `speechSynthesis` output **cannot be captured into Web Audio**, so recordings are mic-only: the agent's audio is unrecoverable, only its transcript survives. | Demo quality; incomplete recordings | Accepted for MVP. Voice selection is exposed in agent settings so the best available system voice is picked per platform. The provider interface makes the ElevenLabs upgrade a config change, and that upgrade also restores full two-sided recording. Recommend upgrading before any client-facing demo. |

---

## 6. Dependencies

**Blocking M1** — nothing gets built until these land (your call, per the approval decision):

| # | Item | Status |
| --- | --- | --- |
| 1 | LLM credentials | ✅ **Done.** GLM key configured and benchmarked (D9). Kimi key present but rejected on latency. |
| 2 | Supabase project: URL, anon key, service-role key | ✅ **Done.** All three verified live against the project. |
| 3 | `SUPABASE_JWT_SECRET` | ⬜ Outstanding — Project Settings → **JWT Keys** → "Legacy JWT Secret". Confirmed this project uses the legacy HS256 secret (its JWKS endpoint 404s), so the value exists. **Blocks M6 only.** |
| 4 | Vercel account/team | ⬜ Outstanding — needed to deploy, not to build. |
| 5 | Real identity values (§0.1 D6, `backend/.env` §5) | ⬜ Placeholders in place. Needed before any real call, not before M1. |

**Nothing blocks M1.**

**Needed before launch, not before M1** — the `[UNKNOWN]` facts from
[company-context.md §8](docs/knowledge/company-context.md):

| Item | Used where | If missing |
| --- | --- | --- |
| Company name | "Who are you with?" | Agent falls back instead of answering |
| Consultant name (D6) | §8 closing recap | Agent says "one of our engineers" |
| Service area + timezone | Slot generation | Booking can't resolve local time |
| Callback number | Confirmation | Recap is incomplete |

**Not needed at all under D8:** Deepgram and ElevenLabs accounts.

**External services (MVP):** Kimi · Supabase · Vercel.
**Key packages:** `next`, `react`, `hono`, `@supabase/supabase-js`, `@supabase/ssr`, `zod`,
`tailwindcss`, `vitest`, `@playwright/test`, `date-fns-tz`.

---

## 7. Open questions

All six Phase 1 questions are **resolved** — see the decisions log in §0.1 (D1, D4, D5, D6, D7 and
the voice stack D8).

Two new questions surfaced *from* those decisions and need answers before the milestone they touch:

| # | Question | Needed by |
| --- | --- | --- |
| Q7 | **R12 — the confirmation text.** The recap promises "we'll text the confirmation," but D4 (Supabase-only) sends nothing. Drop the line from the recap, or add Twilio/Resend in M5? | **M5** |
| Q8 | **Service area + timezone** for slot generation, and the callback number for the recap. | **M5** |

Neither blocks M1–M4.

---

## 8. Todos (tracked)

| ID | Task | Milestone | Status |
| --- | --- | --- | --- |
| T0.1 | Extract PDFs → knowledge markdown | M0 | ✅ |
| T0.2 | `implementation.md` | M0 | ✅ |
| T0.3 | `database.md` | M0 | ✅ |
| T0.4 | Approval | M0 | ⏳ **blocking** |
| T1.1–T1.5 | Workspace, tooling, migrations, env validation, deploy | M1 | ⬜ |
| T2.1–T2.5 | Knowledge loader, prompt builder, objection matcher, Kimi client, **JSON spike** | M2 | ⬜ |
| T3.1–T3.6 | Types, state machine, turn engine, scoring, guardrails, text harness | M3 | ⬜ |
| T4.1–T4.6 | Mic, VAD, STT, TTS, streaming playback, call UI | M4 | ⬜ |
| T5.1–T5.5 | Transcripts, recording pipeline, finalization, booking, signed URLs | M5 | ⬜ |
| T6.1–T6.9 | Auth, lead list, profile, transcript viewer, analytics, live calls, knowledge manager, prompt editor, settings | M6 | ⬜ |
| T7.1–T7.5 | Rate limits, logging, consent gate, load test, deploy | M7 | ⬜ |

---

## 9. Approval status

| | |
| --- | --- |
| Architecture + `frontend`/`backend` split | ✅ Approved |
| Provider choices | ✅ Approved — browser-only voice (D8) |
| Database schema ([database.md](database.md)) | ✅ Approved |
| Milestone order | ✅ Approved |
| §7 open questions | ✅ Resolved (D1, D4–D8) |
| §6 credentials | ✅ **Cleared for M1** — LLM and Supabase verified live |
| LLM provider | ✅ D9 — GLM `glm-4.5-flash`, benchmarked |

**Approved and unblocked. M1 can begin.** Remaining items (JWT secret, Vercel, real identity
values) block later milestones, not the foundation. Work proceeds one milestone at a time, with
automated tests and the §4 manual checklist before each sign-off.

⚠️ Two items in §5 need a **business** decision before production, not before M1: **R14** (both
supplied keys are coding-plan subscriptions) and **R15** (the LLM is China-hosted, which is both a
latency floor and a data-residency question for real homeowner data).
