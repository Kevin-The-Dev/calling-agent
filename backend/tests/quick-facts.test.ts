import { describe, expect, it } from 'vitest';
import {
  cleanUtterance,
  findEmail,
  formatPhone,
  normalizeLead,
  findHomeownerYes,
  findName,
  findPhone,
  quickFacts,
  withQuickFacts,
} from '../src/agents/quick-facts.js';

describe('findPhone', () => {
  it.each([
    ['my number is 510 555 1212', '510-555-1212'],
    ['sure, (510) 555-1212', '510-555-1212'],
    ['5105551212', '510-555-1212'],
    ['it is 1 510 555 1212', '510-555-1212'],
    ['five one zero five five five one two one two', '510-555-1212'],
    ['oh, it’s 510 555 1212', '510-555-1212'],
    ['510, 555, 1212 is the best one', '510-555-1212'],
  ])('reads "%s"', (utterance, expected) => {
    expect(findPhone(utterance)).toBe(expected);
  });

  it.each([
    'my bill is about 240 a month',
    'we live at 1234 Main Street',
    'about 150, maybe 200',
    'yes I own it',
  ])('finds no phone number in "%s"', (utterance) => {
    expect(findPhone(utterance)).toBeNull();
  });
});

describe('findEmail', () => {
  it.each([
    ['it is kevin@gmail.com', 'kevin@gmail.com'],
    ['Kevin.Smith@Yahoo.com', 'kevin.smith@yahoo.com'],
    ['kevin at gmail dot com', 'kevin@gmail.com'],
    ['k dot smith at yahoo dot com', 'k.smith@yahoo.com'],
    ['buildour.ai at gmail.com', 'buildour.ai@gmail.com'],
  ])('reads "%s"', (utterance, expected) => {
    expect(findEmail(utterance)).toBe(expected);
  });

  it.each(['I would rather not', 'we are at home most days', 'look at that'])(
    'finds no email in "%s"',
    (utterance) => {
      expect(findEmail(utterance)).toBeNull();
    },
  );
});

describe('findName', () => {
  it.each([
    ['I am Kevin', 'Kevin'],
    ["I'm Kevin", 'Kevin'],
    ['This is Maria', 'Maria'],
    ['my name is kevin', 'Kevin'],
    ['Dave here', 'Dave'],
  ])('reads "%s"', (utterance, expected) => {
    expect(findName(utterance)).toBe(expected);
  });

  it.each(["I'm good thanks", "I'm not interested", 'this is a bad time', 'yes', "I'm Busy"])(
    'finds no name in "%s"',
    (utterance) => {
      expect(findName(utterance)).toBeNull();
    },
  );
});

describe('withQuickFacts', () => {
  it('replaces a phone or email the prospect has just corrected', () => {
    const lead = withQuickFacts(
      { name: 'Kevin', phone: '510-555-0000' },
      quickFacts('actually it is 510 555 1212'),
    );
    expect(lead.phone).toBe('510-555-1212');
  });

  it('never renames a prospect whose name is already known', () => {
    const lead = withQuickFacts({ name: 'Kevin' }, quickFacts("this is Maria's house"));
    expect(lead.name).toBe('Kevin');
  });
});

describe('findHomeownerYes', () => {
  const ASKED = 'Got it. And are you the owner of the home?';

  it.each(['yes', 'yeah I do', 'Yes I own it', "I'm the homeowner", 'we own the house'])(
    'hears "%s" as a yes to the ownership question',
    (utterance) => {
      expect(findHomeownerYes(utterance, ASKED)).toBe(true);
    },
  );

  it.each(['no I rent', "yes but my parents own it", "I don't", 'not really'])(
    'leaves "%s" to the extractor',
    (utterance) => {
      expect(findHomeownerYes(utterance, ASKED)).toBe(false);
    },
  );

  it('ignores a yes to a different question', () => {
    expect(findHomeownerYes('yes', 'Is the number ending in 1212 the best one?')).toBe(false);
  });
});

describe('cleanUtterance', () => {
  it.each([
    ['kevin dot test at gmail dot com', 'kevin.test@gmail.com'],
    ['sure it is kevin dot test at gmail dot com', 'sure it is kevin.test@gmail.com'],
    ["yeah it's 510 555 1212", "yeah it's 510-555-1212"],
    ['(510) 555-1212', '510-555-1212'],
    ['my name is kevin', 'my name is Kevin'],
    ['we are with p g and e', 'we are with PG&E'],
    ['PG and E', 'PG&E'],
    ['sdg and e I think', 'SDG&E I think'],
  ])('writes "%s" as "%s"', (heard, written) => {
    expect(cleanUtterance(heard)).toBe(written);
  });

  it.each(["I'm thinking about it", 'this is great', 'my bill is about 240', "I'm not sure"])(
    'leaves "%s" meaning exactly the same',
    (heard) => {
      expect(cleanUtterance(heard).toLowerCase()).toBe(heard.toLowerCase());
    },
  );
});

describe('normalizeLead', () => {
  it('stores contact details in one consistent form', () => {
    expect(
      normalizeLead({
        name: 'kevin test',
        phone: '5105551212',
        email: ' Kevin.Test@Gmail.com ',
        utility_provider: 'pg and e',
      }),
    ).toEqual({
      name: 'Kevin Test',
      phone: '510-555-1212',
      email: 'kevin.test@gmail.com',
      utility_provider: 'PG&E',
    });
  });

  it('keeps a name the way it was written when it already has capitals', () => {
    expect(normalizeLead({ name: 'Mary-Ann McDonald' }).name).toBe('Mary-Ann McDonald');
  });

  it('capitalizes an address recognition wrote in lower case, and leaves a written one alone', () => {
    expect(normalizeLead({ address: '123 maple street san jose' }).address).toBe('123 Maple Street San Jose');
    expect(normalizeLead({ address: '1 Main St, Apt 4B' }).address).toBe('1 Main St, Apt 4B');
  });

  it('leaves a number that is not ten digits alone', () => {
    expect(formatPhone('555 1212')).toBe('555 1212');
  });
});
