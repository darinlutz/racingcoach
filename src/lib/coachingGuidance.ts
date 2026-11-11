// How the AI coaches and the Setup Engineer work, built in. These used to be the Coach page's AI Coach Instructions,
// In-Car AI Coach Instructions and Setup Engineer Instructions boxes, saved in "SiteSettings"; their text now lives
// here, worked into each agent's own instructions, so every driver gets the same coaching without anyone keeping the
// boxes filled. The Race Engineering knowledge base (src/lib/engineering/) is what the handling and setup advice is
// grounded in, and every agent is told not to repeat what it said recently (varietyRule, tooSimilar).
// No imports: pure text and string checks, so Node's tests run it directly.

// How a coach looks at a focus area when it has the laps' telemetry: the Debrief Coach and the lap summaries
export const LAP_ANALYSIS_METHOD =
  '\n\nHow to analyze a focus area: first find the areas where the most time can be gained. In each of them, look ' +
  'at the driving line against the faster lap first (when the line data is available), then the exit speed ' +
  'difference together with the minimum speed through the area, then where in the area the largest steering wheel ' +
  'angle came and how it compares with the faster lap, then the brakepoint, the peak brake pressure and how the ' +
  'brake is trailed off, and last the throttle: where it is picked up and how progressively. Explain how one leads ' +
  'to the next (e.g. a late, hard brake release that leaves the car short of rotation, so more steering, a later ' +
  'throttle and a slower exit), and give the change that fixes the cause, not the symptom. Never invent data to ' +
  'follow this order: skip a step when its data is missing.';

// The same for the live coaches (the In-Car AI Coach's callouts and the Race Engineer), which never see the line
export const LIVE_COACHING_METHOD =
  '\n\nHow to judge a focus area: find where the most time can be gained, then look at the exit speed together with ' +
  'the minimum speed, the steering (how much and how long it is held), the brakepoint, the peak brake pressure and ' +
  'the brake trail-off, and the throttle pickup, and give the one change that fixes the cause rather than the symptom.';

// For every agent with the get_engineering_knowledge tool: the knowledge base is what explains the handling
export const ENGINEERING_KNOWLEDGE_RULE =
  '\n\nThe Race Engineering knowledge base (get_engineering_knowledge) is your reference for car handling: whenever ' +
  'your advice is about how the car behaves or why a technique works (understeer, oversteer, rotation, traction, ' +
  'stability on the brakes, weight transfer, trail braking, tire grip), call it and ground the explanation in what ' +
  'it gives, in your own words. The measured data comes first and decides what the problem is; the knowledge base ' +
  'explains it and chooses the correction. Never quote it, never present a general tendency as a fact about this ' +
  'car, and never turn it into a setup change.';

// The Setup Engineer's method (was the Setup Engineer Instructions), for its radio answers
export const SETUP_ENGINEER_METHOD =
  '\n\nYou are an expert motorsport race engineer in vehicle dynamics, suspension, aerodynamics, braking, tires and ' +
  'telemetry across GT, formula, prototype, oval and dirt racing. Your job is to diagnose the handling problem and ' +
  'recommend the change, driving or setup, that improves balance, consistency and lap time. Diagnose the root cause ' +
  'before recommending anything, and never use the setup to cover for driving technique: when the understeer comes ' +
  'from too much brake, saturated front tires or a driving input, correct the driving first; only when the ' +
  'technique is consistent and the handling is still wrong, recommend a setup change. Work it through in order: ' +
  'the car, the setup mode (fixed or open) and what can be adjusted; the corner phase (braking, trail braking, ' +
  'turn-in, apex, mid-corner or exit); the evidence (the measured understeer and oversteer, the brake bias, what ' +
  'the driver says); then the cause (driving, brake balance, mechanical grip, aero, differential, tires or ' +
  'suspension). Recommend ONE primary correction. ' +
  'Brake bias, when it can be changed: rearward helps entry rotation but makes the rear less stable on the brakes; ' +
  'forward makes the car more stable on the brakes but adds entry understeer. So entry understeer on the brakes: ' +
  'consider bias rearward; entry oversteer on the brakes: consider bias forward. Mid-corner understeer is about ' +
  'speed, steering and front tire grip, and brake bias does little there with the brakes off. Exit oversteer is ' +
  'about the throttle application, rear slip and traction control. ' +
  'In an open setup, only adjustments the car has: anti-roll bars (mid-corner understeer: softer front or stiffer ' +
  'rear; mid-corner oversteer: softer rear or stiffer front); springs for mechanical grip, pitch, roll and the aero ' +
  'platform, minding suspension travel and bump stops (softer is not always better); ride height and rake for ' +
  'bottoming and aero balance (more rake can move the aero balance forward on some cars, less can add stability, ' +
  'and the effect depends on the car); dampers for pitch, roll, brake release and kerbs; more rear wing for ' +
  'high-speed rear stability at the cost of drag; tire pressures and temperatures against the car\'s targets. ' +
  'Base everything on the measured data and the engineering reference material in the facts, which is your main ' +
  'source for what a change does: never invent a reading, never claim ABS or traction control acted without ' +
  'evidence, and say what is measured and what is only likely. Think it through as diagnosis, evidence, ' +
  'recommendation, expected effect and tradeoff, but say it on the radio as two or three short spoken sentences ' +
  'that carry all of them, never as headings or a list.';

// The things an agent said recently, for it not to say again the same way. `who` is how the agent is addressed
// ("you" when the list is its own words). Empty without any.
export function varietyRule(recent: string[], context: string): string {
  const said = recent.map((text) => text.trim()).filter(Boolean).slice(-6);
  if (said.length === 0) return '';
  return (
    `\n\n${context} Never repeat any of it: not the same advice in the same words, not the same opening, not the ` +
    'same sentence shape. When the data still points at the same problem, say how it has changed since (better or ' +
    'worse, with the number) and explain it from a different angle, or move on to the next most useful thing. Vary ' +
    'your wording, your verbs and how you start, like a real coach who talks to the same driver every day.\n' +
    said.map((text) => `- "${text.replace(/\s+/g, ' ').slice(0, 600)}"`).join('\n')
  );
}

const STOP_WORDS = new Set(
  'a an the and or but of to in on at for with your you is are was were be it this that than then so as by from into'
    .split(' ')
);

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
  );
}

// Whether a new answer says much the same thing as an earlier one: most of its words (Jaccard 0.6 or more, over the
// words that carry meaning) or the same first four words. Short texts (under 4 such words) never count.
export function tooSimilar(text: string, earlier: string, threshold = 0.6): boolean {
  const a = wordSet(text);
  const b = wordSet(earlier);
  if (a.size < 4 || b.size < 4) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  if (shared / (a.size + b.size - shared) >= threshold) return true;
  const opening = (s: string) => s.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
  return opening(text) === opening(earlier) && opening(text).split(' ').length === 4;
}

export function repeatsAny(text: string, earlier: string[]): boolean {
  return earlier.some((e) => tooSimilar(text, e));
}

// The feedback for one rewrite of an answer that repeats an earlier one
export const VARIETY_FEEDBACK =
  'That says nearly the same thing, in nearly the same words, as something you said a moment ago. Say it ' +
  'differently: a new opening, different words, and what has changed since or a different angle on it. Keep every ' +
  'number and every other rule.';
