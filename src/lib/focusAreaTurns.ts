// Which turns a focus area covers, from its name in Track Data ("T 7", "T4&5", "T2-T3", "T7-9", "Turn 11"), so a
// coach asked about "Turn 4" knows which focus area that is. Names without turn numbers ("Bus Stop") cover none: the
// laps aren't measured anywhere else, so where such a turn is isn't known.
// No imports, so `node` runs it directly.

const TURN_RE = /(?<!\p{L})(?:t|turns?|curvas?|kurven?)\s*(\d+)((?:\s*(?:&|,|\/|-|–|and|e|y|und)\s*(?:t|turns?|curvas?|kurven?)?\s*\d+)*)/giu;

export function areaTurns(name: string): number[] {
  const turns = new Set<number>();
  for (const match of name.matchAll(TURN_RE)) {
    let previous = Number(match[1]);
    turns.add(previous);
    for (const [, joiner, digits] of match[2].matchAll(/\s*(&|,|\/|-|–|and|e|y|und)\s*\p{L}*\s*(\d+)/gu)) {
      const turn = Number(digits);
      // "T7-9" is turns 7, 8 and 9; "T4&5" just 4 and 5
      if ((joiner === '-' || joiner === '–') && turn > previous && turn - previous <= 10) {
        for (let t = previous + 1; t < turn; t++) turns.add(t);
      }
      turns.add(turn);
      previous = turn;
    }
  }
  return [...turns].sort((a, b) => a - b);
}

// The focus area a coach's tool was asked about: by its exact name, else by a turn it covers ("Turn 4", "T4", "4")
export function findFocusArea<T extends { name: string }>(areas: T[], asked: string): T | undefined {
  const wanted = asked.trim().toLowerCase();
  const exact = areas.find((a) => a.name.toLowerCase() === wanted);
  if (exact) return exact;
  const turns = /^\d+$/.test(wanted) ? [Number(wanted)] : areaTurns(asked);
  return turns.length === 0 ? undefined : areas.find((a) => areaTurns(a.name).some((t) => turns.includes(t)));
}

// "T4&5 (turns 4, 5)", for a prompt's list of focus areas
export function describeAreaTurns(name: string): string {
  const turns = areaTurns(name);
  return turns.length === 0 ? `${name} (no turn numbers in its name)` : `${name} (turn${turns.length === 1 ? '' : 's'} ${turns.join(', ')})`;
}
