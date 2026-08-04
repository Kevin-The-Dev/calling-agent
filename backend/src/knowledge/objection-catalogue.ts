/**
 * The objection catalogue.
 *
 * Every entry traces to docs/knowledge/objection-handling.md — 6 early
 * objections handled with A.I.R., and 18 late objections handled with the
 * 6-step framework.
 *
 * The `guidance` field is the *strategy*, not a script. It is injected into the
 * prompt so the model knows which content to convey; the model re-words it. The
 * agent must never recite these verbatim (claude.md §5).
 */
import type { ObjectionClass } from '../types/domain.js';

export interface ObjectionEntry {
  id: string;
  objectionClass: ObjectionClass;
  label: string;
  /** Phrases that strongly indicate this objection. Lowercase, matched as substrings. */
  phrases: string[];
  /** Single words that weakly indicate it. Matched on word boundaries. */
  keywords?: string[];
  /** Strategy summary injected into the prompt. */
  guidance: string;
  /** Set when matching this objection also triggers a disqualification path. */
  dqHint?: 'not_homeowner' | 'bill_under_60' | 'moving_under_6_months';
}

export const OBJECTION_CATALOGUE: ObjectionEntry[] = [
  // ── Early objections — A.I.R. (Agree, Ignore, Resume) ─────────────────────
  {
    id: 'early.not_interested',
    objectionClass: 'early',
    label: "I'm not interested",
    phrases: [
      'not interested',
      'no interest',
      "don't want",
      'do not want',
      'not looking for',
      'no thanks',
      'no thank you',
    ],
    guidance:
      'Agree briefly and clarify you are not trying to sell anything. Then resume: you are only ' +
      'letting them know what is happening in their area so they are aware. Do not argue, do not ' +
      'pitch, do not ask permission to continue.',
  },
  {
    id: 'early.busy',
    objectionClass: 'early',
    label: "I'm busy",
    phrases: [
      'busy',
      'bad time',
      'in the middle of',
      "can't talk",
      'cannot talk',
      'at work',
      'driving',
      'no time',
      'running out the door',
    ],
    guidance:
      'Agree and promise to keep it short. Then resume: they are probably seeing more solar panels ' +
      'nearby, and that is what this is about.',
  },
  {
    id: 'early.send_email',
    objectionClass: 'early',
    label: 'Send me an email',
    phrases: ['send me an email', 'send an email', 'email me', 'send me some info', 'send info'],
    guidance:
      'Agree and ask for the email address. Then resume: before you can send it you need to ' +
      'qualify them in the system, so ask the next qualifying question.',
  },
  {
    id: 'early.call_back',
    objectionClass: 'early',
    label: 'Call me back',
    phrases: ['call me back', 'call back later', 'call another time', 'try me later', 'call later'],
    guidance:
      'Agree you can do that. Then, before letting them go, confirm they still live at the ' +
      'address. Promise it will only take thirty seconds.',
  },
  {
    id: 'early.how_got_number',
    objectionClass: 'early',
    label: 'How did you get my number?',
    phrases: [
      'how did you get my number',
      'where did you get my number',
      'who gave you my number',
      'how do you have my',
      'where did you get my info',
    ],
    guidance:
      'Agree it is a fair question: you are only reaching out to homeowners in their zip code. ' +
      'Resume: they were not targeted personally, this is for homes that qualify.',
  },
  {
    id: 'early.too_many_calls',
    objectionClass: 'early',
    label: 'You people keep calling',
    phrases: [
      'fifth person',
      '5th person',
      'keep calling',
      'called me before',
      'called already',
      'so many calls',
      'third time',
    ],
    guidance:
      'Agree: you have been trying to reach them about important updates regarding electricity. ' +
      'Resume: this is a short info call to see if the property qualifies.',
  },

  // ── Late objections — 6-step framework ────────────────────────────────────
  {
    id: 'late.1_roof_holes',
    objectionClass: 'late',
    label: "I don't want holes in my roof",
    phrases: ['holes in my roof', 'drill', 'holes in the roof', 'penetrate', 'punch holes'],
    guidance:
      'Installation uses K2 racking with seals on both top and bottom. Covered by a 10-year roof ' +
      'warranty — if anything happens it is replaced, and the finance company assumes ' +
      'responsibility.',
  },
  {
    id: 'late.2_old_roof',
    objectionClass: 'late',
    label: 'My roof is too old',
    phrases: [
      'roof is old',
      'roof is too old',
      'replacing my roof',
      'need a new roof',
      'new roof',
      'roof needs work',
      'redoing the roof',
    ],
    guidance:
      'A new roof can be added into the project. Some clients have had the roof covered — say ' +
      '"I am not promising that, but that is what we have seen happen for some of our clients." ' +
      'The hedge is mandatory.',
  },
  {
    id: 'late.3_special_roof',
    objectionClass: 'late',
    label: 'I have a flat/tile/special roof',
    phrases: ['flat roof', 'tile roof', 'clay tile', 'metal roof', 'spanish tile', 'unusual roof'],
    guidance: 'Not a problem — all roof types work: flat, tile, shingle. We have done it all before.',
  },
  {
    id: 'late.4_leaks',
    objectionClass: 'late',
    label: 'I am worried about leaks',
    phrases: ['leak', 'water damage', 'leaking'],
    guidance:
      'A workmanship warranty covers anything that goes wrong due to the installation for up to ' +
      '10 years.',
  },
  {
    id: 'late.5_appearance',
    objectionClass: 'late',
    label: "I don't like how panels look",
    phrases: ['how it looks', 'how they look', 'ugly', 'eyesore', 'appearance', 'aesthetic'],
    guidance:
      'Panels can go on a less visible side, such as the back. The panels are completely black and ' +
      'blend into the roof. It ends up looking clean.',
  },
  {
    id: 'late.6_roi',
    objectionClass: 'late',
    label: "I don't see the ROI",
    phrases: [
      'return on investment',
      'roi',
      'worth the investment',
      'pay for itself',
      'payback',
      'break even',
    ],
    guidance:
      'Agree — because there is no investment. They are not putting their own money in, just ' +
      'shifting where the money goes. Instead of paying the electric company, they save from ' +
      'month one.',
  },
  {
    id: 'late.7_another_bill',
    objectionClass: 'late',
    label: "I don't want another bill",
    phrases: ['another bill', 'more bills', 'another payment', 'extra bill', 'one more bill'],
    guidance:
      'This is not about adding a bill. The aim is to eliminate the electric bill completely and ' +
      'replace it with one that is usually 20 to 50% cheaper. (Always 20–50%, never 30–50% — ' +
      'decision D7.)',
  },
  {
    id: 'late.8_low_bill',
    objectionClass: 'late',
    label: 'My bills are already low',
    phrases: ['bill is low', 'bills are low', "don't pay much", 'pay very little', 'already low'],
    guidance:
      'Ask what they currently pay. Over $150: you can probably reduce it significantly. Under ' +
      '$60: be honest that it may not be worth it and the property would likely be disqualified. ' +
      'Between $60 and $150: you can still help them save and lock in a fixed rate.',
    dqHint: 'bill_under_60',
  },
  {
    id: 'late.9_catch',
    objectionClass: 'late',
    label: "What's the catch?",
    phrases: ["what's the catch", 'what is the catch', 'too good to be true', 'sounds too good'],
    guidance:
      'The only catch is that they need to qualify — that is what the call is about. If they ' +
      'qualify they simply switch to a better energy provider at a locked-in, lower rate.',
  },
  {
    id: 'late.10_no_finance',
    objectionClass: 'late',
    label: "I don't want to finance anything",
    phrases: [
      "don't want to finance",
      'no loan',
      "don't want a loan",
      'not taking a loan',
      'no financing',
      'no debt',
    ],
    guidance:
      'Not a traditional loan. They are switching from one electric provider that charges more to ' +
      'another that charges less. The payment becomes more stable and more affordable.',
  },
  {
    id: 'late.11_wait_prices',
    objectionClass: 'late',
    label: 'I want to wait until prices drop',
    phrases: [
      'wait until prices',
      'prices drop',
      'prices come down',
      'wait for the technology',
      'get cheaper',
      'wait a year',
    ],
    guidance:
      'With inflation nothing is getting cheaper. Even as technology improves, prices usually go ' +
      'up. Waiting often means missing the window to lock in lower rates now.',
  },
  {
    id: 'late.12_bad_credit',
    objectionClass: 'late',
    label: "My credit isn't good",
    phrases: ['credit is bad', "credit isn't good", 'bad credit', 'poor credit', 'low credit score'],
    guidance:
      'Thank them for being honest. Ladder: is anyone else on the home above 650? If not, is there ' +
      'someone who would co-sign or be included? If unsure, ask their approximate score and offer ' +
      'to check with the manager.',
  },
  {
    id: 'late.13_renter',
    objectionClass: 'late',
    label: 'I rent / not the homeowner',
    phrases: [
      'i rent',
      "i'm renting",
      'i am renting',
      'not the homeowner',
      "don't own",
      'do not own',
      'my landlord',
      "landlord's",
    ],
    guidance:
      'The program is only available to homeowners. Offer to speak with the landlord — the owner ' +
      'benefits from the tax credit and added property value while the tenant still pays the bill. ' +
      'This is a disqualification for this prospect.',
    dqHint: 'not_homeowner',
  },
  {
    id: 'late.14_has_tenant',
    objectionClass: 'late',
    label: 'I have a tenant living there',
    phrases: ['tenant', 'renting it out', 'rental property', 'i rent it out', 'my renters'],
    guidance:
      'Fine — many landlords have installed solar on rentals. The tenant keeps paying for power ' +
      'while the owner gets the financial benefit: tax credit and added property value. This ' +
      'still qualifies.',
  },
  {
    id: 'late.15_moving',
    objectionClass: 'late',
    label: "I'm planning to move",
    phrases: ['planning to move', 'moving out', 'selling the house', 'selling my home', 'relocating'],
    guidance:
      'Ask exactly when. Under 6 months: it makes sense to wait until they are in the new home — ' +
      'disqualify. Over 6 months: they still benefit, and the new owner benefits too, which makes ' +
      'the property more appealing. Then ask whether they have listed it yet.',
    dqHint: 'moving_under_6_months',
  },
  {
    id: 'late.16_renovations',
    objectionClass: 'late',
    label: "I'm planning renovations",
    phrases: ['renovation', 'remodel', 'redoing the kitchen', 'new kitchen', 'construction'],
    guidance:
      'Good timing: renovation work can be bundled into the solar financing, and potentially 30% ' +
      'covered through the federal tax credit. In some cases part of the commission can help cover ' +
      'the cost upfront. Keep "potentially" — do not promise.',
  },
  {
    id: 'late.17_bad_experience',
    objectionClass: 'late',
    label: 'Someone I know had a bad experience',
    phrases: [
      'bad experience',
      'my cousin',
      'my friend had',
      'my neighbor had',
      'got ripped off',
      'scam',
      'scammed',
    ],
    guidance:
      'You do not know what happened with other companies, but you are not here scamming people — ' +
      'just booking appointments with homeowners to see if solar would help them save. If they ' +
      'insist, ask what happened, let them speak, then offer to have the engineer come out with ' +
      'that person present.',
  },
  {
    id: 'late.18_send_email',
    objectionClass: 'late',
    label: 'Just send me an email (late stage)',
    phrases: ['just send me an email', 'email me the info', 'send me the details', 'put it in writing'],
    guidance:
      'Yes — capture the email. Then explain you need a couple of quick questions first to make ' +
      'sure the home qualifies, so the engineer can build a personalized report. The engineer ' +
      'normally needs to check the meter; if everything checks out they can show the report on ' +
      'the spot, and it can still be emailed afterwards.',
  },
];

export const OBJECTIONS_BY_ID = new Map(OBJECTION_CATALOGUE.map((o) => [o.id, o]));
