# Appointment Booking

> **Source:** `Solar_Sales_Script_v2.pdf` §5–§8
> Covers decision-maker identification, slot selection, locking, and the closing recap.

**Decisions affecting this document (2026-08-05):**
- **D4** — appointments are stored in Supabase only. No calendar sync.
- **D6** — the agent uses a **single consultant name** from `agent_settings.consultant_name`,
  exactly as the script writes it. If that setting is empty the agent says "one of our engineers"
  and never invents a name.
- **⚠️ Open (Q7)** — §4c and the recap promise a **confirmation text**, but Supabase-only booking
  does not send one. Either the texting language comes out of the script or an SMS/email step gets
  added. Until that is decided, the agent must not promise a text it cannot send.

---

## 1. Pre-condition — decision makers first

**Never propose a time before identifying decision makers.**

> "Now before we get you scheduled — are there any other decision makers in the household? A spouse
> or partner who would need to be part of this conversation?"

- Capture every name into `decision_makers[]`.
- This is critical — their attendance **must** be confirmed in the lock step.

Also required before booking (see [qualification-rules.md](qualification-rules.md) §9): name,
address, homeowner confirmed, home type, roof ownership, monthly bill, utility provider, credit band.

---

## 2. Frame the appointment

> "Perfect. So what we'll do is get one of our engineers out to take a look at your home. It'll take
> about 10 to 15 minutes to evaluate, and another 10 to 15 to walk you through exactly what you
> qualify for and how much you can save. They're not in a rush, so if you have any questions,
> they'll be right there to answer everything."

**Facts:** 10–15 min evaluation + 10–15 min walkthrough (~20–30 min total) · not rushed ·
questions welcome · nothing out of pocket.

---

## 3. Narrow, then propose

**Two-step close. Never ask an open-ended "when are you free?"**

1. > "Does morning or afternoon work better for you?"
2. Offer a **specific** time inside the window they chose:
   > "Great — I have [APPOINTMENT DATE & TIME] open. Does that work for you?"

If the proposed slot fails, offer **one** alternative in the same window, then widen.

### Slot generation rules
| Rule | Value |
| --- | --- |
| Morning window | 09:00 – 12:00 |
| Afternoon window | 13:00 – 18:00 |
| Slot length | 45 min (30 min consult + 15 min buffer) |
| Earliest bookable | next calendar day |
| Booking horizon | 14 days (matches "here for the next couple of weeks") |
| Timezone | resolved from the lead's address; store UTC + IANA timezone |
| Never offer | a slot already taken, or a slot in the past in the lead's local time |

---

## 4. Lock the appointment (§7)

Three confirmations, in order. Do not skip any.

**a) Clear the calendar conflict**
> "Awesome. Now [NAME], just to be sure — is there anything that would keep you from being available
> at [APPOINTMENT DATE & TIME]? A doctor's appointment, another commitment, anything at all around
> that time?"

Resolve conflicts **now**, not later.

**b) Confirm decision-maker attendance**
> "And you mentioned [SPOUSE/PARTNER NAME] — they're going to be there at [APPOINTMENT DATE & TIME]
> as well, right?"

If they cannot attend:
> "What time do they usually get home? Let's find a time that works for both of you."

→ Return to slot selection and re-lock. Set `decision_makers_present = false` until resolved.

**c) Confirm the callback number**
> "Is [PHONE NUMBER — last four digits] the best number to text the confirmation to?"

Confirm or update. Read back **only the last four digits**.

---

## 5. Recap & close (§8)

> "Alright [NAME], let me just quickly go over what's happening so we're on the same page:"

Five recap points — all five are required, and each sets a tracked flag:

| # | Recap point | Flag |
| --- | --- | --- |
| 1 | Consultant **[CONSULTANT NAME]** comes to **[ADDRESS]** on **[APPOINTMENT DATE & TIME]** | `recap_details_given` |
| 2 | They will **call before heading over** to make sure everything is still good | `reminded_confirmation_call` |
| 3 | Have your **most recent electricity bill** ready for the most accurate savings estimate | `reminded_utility_bill` |
| 4 | Make sure **all decision makers ([NAMES]) are present** so you can decide together | `reminded_decision_makers` |
| 5 | This is to **save money on electricity — nothing out of pocket**; the engineer determines qualification and savings | `reminded_no_cost` |

Then:
> "Do you have any questions for me before we wrap up?"
>
> "Alright, [NAME] — thanks so much for your time. You're all set with [CONSULTANT NAME] on
> [APPOINTMENT DATE & TIME]. Have a great rest of your day, and we'll see you then!"

---

## 6. Appointment record

| Field | Source | Required |
| --- | --- | --- |
| `scheduled_at` (UTC) + `timezone` | slot selection | ✅ |
| `appointment_type` | in-home / virtual | ✅ |
| `address` | script §1 confirmation | ✅ |
| `consultant_name` | agent settings — `[UNKNOWN]` in the PDFs | ✅ |
| `decision_makers[]` + `decision_makers_present` | §5 / §7b | ✅ |
| `confirmation_phone` | §7c | ✅ |
| `language` | language the appointment was booked in | ✅ |
| `conflict_checked` | §7a answered | ✅ |
| the five recap flags | §8 | ✅ |
| `status` | `booked` \| `rescheduled` \| `cancelled` \| `no_show` \| `held` | ✅ |

An appointment is only written as `booked` when every required field is present **and** all five
recap flags are true. Otherwise the call ends as `partial` and the lead stays in the pipeline.

---

## 7. Outcomes

| Outcome | Meaning |
| --- | --- |
| `booked` | Appointment locked, recap complete |
| `partial` | Qualified but no confirmed slot — needs a human follow-up |
| `callback` | Prospect asked to be called back; capture the preferred time |
| `disqualified` | Hit a DQ rule — record `disqualified_reason` |
| `not_interested` | Two AIR cycles exhausted, or explicit refusal |
| `abandoned` | Call dropped before an outcome was reached |
