import { describe, expect, it } from 'vitest';
import { openingLine } from '../src/agents/opening.js';
import { applyGuardrails } from '../src/agents/guardrails.js';
import type { AgentIdentity } from '../src/knowledge/prompt-builder.js';

const IDENTITY: AgentIdentity = {
  companyName: 'Solar Energy Solutions',
  agentName: 'Alex',
  consultantName: 'Michael',
  serviceArea: 'California',
  callbackNumber: '+1-800-555-0100',
};

/** Every variant, so a rule is never satisfied by only one of them. */
const ALL = [0, 0.4, 0.9].map((seed) => openingLine(IDENTITY, seed));

describe('the opening line', () => {
  it('never asks permission to speak or apologises for calling', () => {
    // The line this replaced: "Hi there, sorry to bother you. Is this a good
    // time to chat for a moment?" — an apology, a permission request and the
    // word "chat", none of which belong to a setter working a street.
    for (const line of ALL) {
      expect(line).not.toMatch(/\bchat\b/i);
      expect(line).not.toMatch(/sorry to bother/i);
      expect(line).not.toMatch(/good time/i);
      expect(line).not.toMatch(/\b(?:a|got a) (?:minute|moment|second)\b/i);
    }
  });

  it('hits the script beats: who is calling, and working right in the corner of the neighborhood', () => {
    for (const line of ALL) {
      expect(line).toContain('Alex');
      expect(line).toContain('Solar Energy Solutions');
      expect(line).toMatch(/right in the corner of your neighborhood/i);
      expect(line).toMatch(/next couple of weeks/i);
    }
  });

  it('asks who it is speaking with, and asks nothing else', () => {
    for (const line of ALL) {
      expect(line).toMatch(/speaking with\?$/i);
      // A greeting plus the one real ask. The script opens exactly this way.
      expect(line.match(/\?/g)).toHaveLength(2);
    }
  });

  it('pitches nothing — solar is two stages away', () => {
    for (const line of ALL) {
      // The configured company is literally called "Solar Energy Solutions", so
      // the word is unavoidable in the introduction; saying who you work for is
      // not the same as raising the subject. Everything the script actually
      // withholds at this beat must still be absent.
      const withoutCompany = line.replace('Solar Energy Solutions', '');
      expect(withoutCompany).not.toMatch(/\b(?:solar|panels?|savings?|bill|SGIP|program)\b/i);
    }
  });

  it('varies between calls so two in a row do not open identically', () => {
    expect(new Set(ALL).size).toBe(3);
  });

  it('survives its own guardrails untouched', () => {
    for (const line of ALL) {
      // Not routed through them in production — the line is authored, not
      // generated — but anything the guardrails would rewrite here is a phrase
      // that should not have been written in the first place.
      const checked = applyGuardrails(line, { enforceOneQuestion: false });
      expect(checked.blocked).toBe(false);
      expect(checked.text).toBe(line);
    }
  });
});

describe('the opening line without full identity', () => {
  it('drops the company rather than inventing one', () => {
    const line = openingLine({ ...IDENTITY, companyName: undefined }, 0);

    expect(line).toContain('Alex');
    expect(line).not.toMatch(/\bover at\b|\bwith\s+$/);
    expect(line).toMatch(/right in the corner of your neighborhood/i);
  });

  it('omits the service area when none is configured', () => {
    const line = openingLine({ ...IDENTITY, serviceArea: undefined }, 0);

    expect(line).not.toMatch(/\bhere in\b/i);
    expect(line).toMatch(/neighborhood, we'll be out here/i);
  });

  it('still says something speakable with no identity at all', () => {
    const line = openingLine(
      {
        companyName: undefined,
        agentName: undefined,
        consultantName: undefined,
        serviceArea: undefined,
        callbackNumber: undefined,
      },
      0,
    );

    expect(line).not.toMatch(/undefined|\[|\]/);
    expect(line).toMatch(/speaking with\?$/i);
  });
});
