// The built-in coaching method and the coaches' variety rules (src/lib/coachingGuidance.ts), no database or AI.
//   node --experimental-transform-types --no-warnings --test scripts/coaching-guidance.test.mjs

import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

let g;
before(async () => {
  g = await import(new URL('../src/lib/coachingGuidance.ts', import.meta.url).href);
});

describe('repeats', () => {
  test('the same advice in nearly the same words is a repeat', () => {
    assert.ok(g.tooSimilar('T3: brake about 20 feet later than your fastest lap', 'T3: brake about 20 ft later than your fastest lap.'));
    assert.ok(g.repeatsAny('Two tenths slower in T1, carry more speed', ['Something else entirely here', 'Two tenths slower in T1, carry more speed!']));
  });

  test('different advice, or the same area said differently, is not', () => {
    assert.ok(!g.tooSimilar('T3: brake about 20 feet later than your fastest lap', 'T7: pick up the throttle sooner on exit'));
    assert.ok(!g.tooSimilar('T3 is better now, a tenth gained; keep that release', 'T3: brake about 20 feet later than your fastest lap'));
  });

  test('the same four opening words count, short texts never do', () => {
    assert.ok(g.tooSimilar('Box this lap please, we need fuel for the end', 'Box this lap please, tires are gone'));
    assert.ok(!g.tooSimilar('Copy that', 'Copy that'));
  });

  test('works on accented languages', () => {
    assert.ok(g.tooSimilar('Freie 20 metros mais tarde na T3 do que na sua volta mais rápida', 'Freie 20 metros mais tarde na T3 do que na sua volta mais rapida'));
  });
});

describe('variety rule', () => {
  test('lists what was said, and nothing without it', () => {
    assert.equal(g.varietyRule([], 'You said this.'), '');
    assert.equal(g.varietyRule(['  ', ''], 'You said this.'), '');
    const rule = g.varietyRule(['First thing', 'Second "quoted"\nthing'], 'You said this.');
    assert.match(rule, /You said this\. Never repeat/);
    assert.match(rule, /- "First thing"/);
    assert.match(rule, /- "Second "quoted" thing"/);
  });

  test('keeps only the latest six', () => {
    const rule = g.varietyRule(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'], 'Said:');
    assert.ok(!rule.includes('"a1"') && !rule.includes('"a2"') && rule.includes('"a8"'));
  });
});

describe('built-in instructions', () => {
  test('the old Coach page instructions are in the prompts', () => {
    assert.match(g.LAP_ANALYSIS_METHOD, /driving line/);
    assert.match(g.LAP_ANALYSIS_METHOD, /steering wheel angle/);
    assert.match(g.LAP_ANALYSIS_METHOD, /trailed off/);
    assert.doesNotMatch(g.LIVE_COACHING_METHOD, /driving line|racing line|apex/, 'the live coaches never see the line');
    assert.match(g.SETUP_ENGINEER_METHOD, /root cause/);
    assert.match(g.SETUP_ENGINEER_METHOD, /ONE primary correction/);
    assert.match(g.SETUP_ENGINEER_METHOD, /two or three short spoken sentences/);
    assert.match(g.ENGINEERING_KNOWLEDGE_RULE, /get_engineering_knowledge/);
  });
});
