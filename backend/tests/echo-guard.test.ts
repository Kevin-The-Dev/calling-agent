import { describe, expect, it } from 'vitest';
import { checkEcho } from '../src/agents/echo-guard.js';

const REPLY = 'Hey Kevin, nice to meet you. And are you the owner of the property?';

describe('checkEcho', () => {
  it('flags the agent reply transcribed back verbatim, across a sentence boundary', () => {
    // The exact turn from the bug report: two agent sentences heard as one.
    expect(
      checkEcho('Hey Kevin nice to meet you and are you the owner of the property', [REPLY]),
    ).toEqual({ kind: 'echo' });
  });

  it('flags a partial echo of the reply', () => {
    expect(checkEcho('are you the owner of the property', [REPLY])).toEqual({ kind: 'echo' });
  });

  it('tolerates the small mistakes recognition makes on synthesized speech', () => {
    // "the" dropped and "and" misheard as "in".
    expect(
      checkEcho('hey kevin nice to meet you in are you owner of the property', [REPLY]),
    ).toEqual({ kind: 'echo' });
  });

  it('keeps the real answer when it follows the echoed tail', () => {
    expect(checkEcho('are you the owner of the property yes I am the owner', [REPLY])).toEqual({
      kind: 'stripped',
      utterance: 'yes I am the owner',
    });
  });

  it('never drops a short answer, even one the agent also said', () => {
    expect(checkEcho('the property', [REPLY])).toEqual({ kind: 'clean', utterance: 'the property' });
    expect(checkEcho('yes', [REPLY])).toEqual({ kind: 'clean', utterance: 'yes' });
  });

  it('lets through a prospect who echoes the question in their own answer', () => {
    const answer = 'Am I the owner? Yeah, my wife and I bought it in 2015.';
    expect(checkEcho(answer, [REPLY])).toEqual({ kind: 'clean', utterance: answer });
  });

  it('lets through an unrelated answer', () => {
    const answer = 'Yeah I own it, we have been here about ten years';
    expect(checkEcho(answer, [REPLY])).toEqual({ kind: 'clean', utterance: answer });
  });

  it('passes everything when there is no agent speech to compare against', () => {
    expect(checkEcho('Hey Kevin nice to meet you', [])).toEqual({
      kind: 'clean',
      utterance: 'Hey Kevin nice to meet you',
    });
  });

  it('ignores apostrophes and punctuation differences', () => {
    expect(
      checkEcho("what's your average monthly electric bill", [
        "Got it. What's your average monthly electric bill, roughly?",
      ]),
    ).toEqual({ kind: 'echo' });
  });
});
