# Qualification Rules

> **Source:** `Solar_Sales_Script_v2.pdf` §3 + qualifying notes, `2nd day Objection sheet.pdf` #8, #12, #13, #14, #15
> Machine-readable rules the agent and the scoring service both use.

---

## 1. Hard disqualifiers (DQ)

If any of these is true, stop qualifying and exit gracefully. Do **not** book an appointment.

| # | Condition | Source | Exit behaviour |
| --- | --- | --- | --- |
| DQ-1 | Not the homeowner **and** the homeowner cannot be brought to the phone | Script §1, Objection #13 | Ask to speak to the owner; if renting, offer to speak with the landlord and capture their contact |
| DQ-2 | Condo/townhome **and** does not own the roof | Script §3 Q3 | Polite close |
| DQ-3 | Monthly bill **< $60** | Objection #8 | "I'll be honest, it might not be worth it for you, and we'd likely disqualify the property." |
| DQ-4 | Moving in **less than 6 months** | Objection #15 | "In that case, it might make sense to wait until you're in your new home." |

> **Not a DQ:** unknown credit score, credit below 650, heavy shading, old roof, tile/flat roof,
> already has a tenant. Each has a defined recovery path — see below.

## 2. Qualifying questions (asked one at a time, in order)

| Q | Question | Captures | Rule |
| --- | --- | --- | --- |
| Q1 | "I'm assuming you're paying more than $150 a month on electricity, right?" | `bill_over_150` | Yes → "Ok, it does seem like the area was affected." No → continue to Q2 |
| Q2 | "What would you say is your average monthly bill?" | `monthly_bill` | React with **genuine surprise** if high |
| Q3 | "Is this a single-family home? And do you own the roof?" | `home_type`, `owns_roof` | Condo/townhome + no roof → **DQ-2** |
| Q4 | "Because this is government-sponsored, there is a minimum credit score of 650 to be eligible. Do you know if yours is above that?" | `credit_score_band` | Unsure → "That's fine — the engineer can help verify during the consultation." |
| Q5 | "Do you have any large trees or structures that block your roof from direct sunlight?" | `shading` | Major shading → note it, **may still qualify** |
| Q6 | "And who is your current electricity provider?" | `utility_provider` | Note for records |

Additional fields captured across the call (not asked as a block): name, phone, email, address,
roof condition & type, taxable income above $45K, already has solar, decision makers, language of
the appointment, appointment type (in-home / virtual).

## 3. Monthly bill bands

| Band | Rule | Agent response |
| --- | --- | --- |
| **> $150** | Strong fit | "Perfect. We can probably reduce that significantly." |
| **$60 – $150** | Still workable | "In that range, we can usually still help you save and lock in a fixed rate — so you're not at the mercy of rate hikes every month. Wouldn't it be nice to just know exactly what you're paying, no surprises?" |
| **< $60** | **DQ-3** | "I'll be honest, it might not be worth it for you, and we'd likely disqualify the property." |

## 4. Credit rules

- Stated minimum: **650**, framed as a requirement of the government-sponsored program.
- Below 650 → recovery ladder (Objection #12):
  1. "Is there anyone else on the home who has a credit score above 650?" → use their credit.
  2. "Is there anyone close to you who would be willing to co-sign or be included to help you qualify?"
  3. "Do you know your approximate credit score? I can check with my manager if it's something we can still work with."
- Unsure → **not** a blocker. The engineer verifies at the consultation.

## 5. Ownership rules

| Situation | Handling |
| --- | --- |
| Homeowner, single-family | Proceed |
| Owns roof but tenant lives there | **Qualifies.** Tenant keeps paying for power; owner gets the tax credit and added property value. Confirm ownership setup. |
| Renter / not the homeowner | **DQ-1.** Offer to speak with the landlord — landlord benefits while tenant pays the bill. |
| Condo/townhome without roof ownership | **DQ-2** |

## 6. Moving rules

| Timeline | Handling |
| --- | --- |
| **< 6 months** | **DQ-4** — suggest waiting until they're in the new home |
| **> 6 months** | Qualifies. Savings still apply, and the new owner benefits — makes the property more appealing. Then: "Have you listed the home yet?" If not listed → "the move is still in the planning phase. This could be a way to reduce costs while you're still there." |

## 7. Qualification score (0–100)

Derived, not asked. Used for dashboard ranking and routing. Any hard DQ forces the score to **0**
and sets `disqualified_reason`.

| Signal | Weight | Scoring |
| --- | --- | --- |
| Monthly bill | 30 | >$250 = 30 · $150–250 = 24 · $100–150 = 15 · $60–100 = 8 · <$60 = DQ |
| Homeowner confirmed | 20 | yes = 20 · unconfirmed = 0 · no = DQ |
| Single-family + owns roof | 15 | yes = 15 · owns roof only = 10 · no = DQ |
| Credit ≥ 650 | 15 | yes = 15 · unsure = 8 · no but co-signer path open = 5 · no = 0 |
| Decision makers identified & available | 10 | all identified and can attend = 10 · identified only = 5 |
| Shading | 5 | none = 5 · partial = 3 · major = 0 |
| Buying intent (see below) | 5 | high = 5 · medium = 3 · low = 0 |

**Bands:** `hot` ≥ 75 · `warm` 50–74 · `cold` 25–49 · `unqualified` < 25 or DQ.

## 8. Buying intent (`low` | `medium` | `high`)

Inferred each turn from the transcript, not asked.

- **High** — asks about timing, cost, or next steps unprompted; volunteers spouse availability;
  agrees to a specific slot; asks what to prepare.
- **Medium** — answers qualifying questions willingly, raises real (late) objections, engages with
  the bill swap.
- **Low** — repeats early objections after two AIR cycles, refuses to answer qualifying questions,
  asks to be removed, or is hostile.

## 9. Data completeness gate

Do **not** move to the appointment stage until all of these are captured:

`name` · `address` · `homeowner_confirmed` · `home_type` · `owns_roof` · `monthly_bill` ·
`utility_provider` · `credit_score_band` · `decision_makers`

`phone` and `email` are captured during confirmation. Missing any gated field → return to
Qualification and ask for it conversationally.
