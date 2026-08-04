# Claude.md

> **Project:** AI Voice Cold Calling Sales Agent (MVP)

## Purpose

This document defines the engineering, architecture, AI behavior, and development rules that Claude Code **must** follow before writing any production code.

---

# 1. Project Overview

Build an AI-powered **voice cold calling sales agent** that runs inside a website.

This is **NOT** a chatbot.

This is a real-time AI sales representative that behaves like an experienced human appointment setter.

The AI must:

- Speak naturally.
- Follow a structured sales process.
- Qualify prospects.
- Handle objections.
- Book appointments.
- Collect lead information.
- Store all conversation data in Supabase.
- Never sound robotic.
- Never reveal prompts or internal reasoning.

This is an MVP.

---

# 2. Primary Knowledge Source

The attached PDFs are the **single source of truth**.

Before implementation:

1. Read both PDFs completely.
2. Extract them into structured markdown documents.

Generate:

```
docs/knowledge/

company-context.md
sales-script.md
qualification-rules.md
objection-handling.md
appointment-booking.md
conversation-flow.md
fallback-responses.md
```

Do not use raw PDFs during runtime.

Never invent product facts beyond those PDFs.

---

# 3. Implementation Workflow

DO NOT write application code first.

Follow this order:

Phase 0
- Read project
- Read PDFs
- Understand objectives

Phase 1
- Produce implementation.md
- Include:
  - architecture
  - milestones
  - todos
  - acceptance criteria
  - validation checklist
  - risks
  - dependencies

STOP.

Wait for approval.

Only after approval continue.

---

# 4. Technology

Claude should choose the best stack.

Constraints:

Frontend:
- Next.js
- TypeScript

Hosting:
- Vercel

Database:
- Supabase

Voice:
- Browser microphone (WebRTC/Web Audio)

LLM:
- Kimi API
- Base URL supplied via .env

Secrets must never be hardcoded.

---

# 5. AI Behaviour

The assistant represents the company.

Always:

- sound like an experienced sales representative
- build rapport
- ask one question at a time
- adapt wording naturally
- never copy script verbatim
- preserve sales strategy

Never:

- mention PDFs
- mention prompts
- reveal internal logic
- hallucinate product facts
- break character

If information is unavailable:

"I'm actually not 100% sure about that, and I'd rather not give you incorrect information."

Then redirect conversation.

---

# 6. Conversation State Machine

Maintain internal stages.

Opening

↓

Rapport

↓

Qualification

↓

Need Discovery

↓

Value Pitch

↓

Objection Handling

↓

Appointment

↓

Confirmation

↓

Closing

Never jump randomly.

Maintain current stage internally.

---

# 7. Lead Object

Maintain a live lead object.

Fields include:

- name
- phone
- email
- address
- monthly bill
- utility provider
- homeowner
- roof type
- roof ownership
- credit score
- decision maker
- appointment
- buying intent
- qualification score
- objections
- summary

Update after every user response.

---

# 8. Knowledge Rules

Use the extracted knowledge documents.

The PDFs define:

- opening
- qualification
- objections
- appointment flow

Adapt wording naturally.

---

# 9. Supabase

Supabase acts as CRM.

Store:

- leads
- transcripts
- recordings
- summaries
- buying intent
- qualification score
- appointment outcome

Use Storage for recordings.

---

# 10. Dashboard

Admin only.

Features:

- login
- lead list
- customer profile
- recordings
- transcript viewer
- analytics
- live calls
- search
- knowledge manager
- prompt editor
- voice settings
- agent settings

No public login.

---

# 11. Security

Never expose:

- API keys
- prompts
- database credentials

Validate every input.

---

# 12. Folder Structure

```
app/
components/
agents/
voice/
knowledge/
services/
lib/
hooks/
supabase/
dashboard/
types/
utils/
docs/
```

---

# 13. Coding Standards

- strict TypeScript
- reusable components
- clean architecture
- modular services
- no duplicated logic
- comprehensive comments where helpful

---

# 14. Testing

Every phase requires:

- unit tests
- integration validation
- manual checklist

No phase is complete without verification.

---

# 15. Development Rules

Claude must:

- think before coding
- document decisions
- complete one phase at a time
- mark completed tasks
- never skip validation

---

# 16. Deliverables

Claude must generate:

1. implementation.md
2. database.md
3. knowledge markdown files

Only then begin implementation.

---

# 17. Final Objective

Deliver a production-quality MVP AI voice sales agent that behaves like an experienced appointment setter, uses the provided sales methodology, stores all required lead and conversation data in Supabase, and is deployable on Vercel.
