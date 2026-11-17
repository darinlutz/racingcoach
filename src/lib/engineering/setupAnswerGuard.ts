import type { ParameterId } from './knowledgeTypes.ts';
import { PARAMETER_LABELS } from './setupCapabilities.ts';

// Checks an engineer's answer for setup parameters the car can't change in this session: any garage change in a
// fixed setup, or a parameter the car doesn't have. Words in English, Portuguese, Spanish, German, French and Italian. A sentence that
// says the parameter can't be changed ("no springs or dampers on a fixed setup") isn't a recommendation, so
// sentences with a negation are skipped. Pure, so `node --test` runs it.

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const PARAMETER_TERMS: Record<ParameterId, RegExp> = {
  brakeBias: /brake bias|brake balance|bias|balanco de freio|distribuicao de frenagem|reparto de frenada|bremsbalance|bremskraftverteilung|repartition de freinage|repartiteur|ripartizione (di |della )?frenata|ripartitore|bilanciamento (dei )?freni/,
  abs: /\babs\b/,
  tractionControl: /traction control|\btc\d?\b|controle de tracao|control de traccion|traktionskontrolle|controle de traction|controllo (di |della )?trazione/,
  engineMap: /engine map|mapa (do )?motor|mapa de motor|motorkennfeld|motor ?map|cartographie moteur|mappa(tura)? (del )?motore/,
  tirePressure: /tire pressure|tyre pressure|\bpressures?\b(?! (of|on) the (brake|pedal))|pressao dos pneus|pressao|presion de (los )?neumaticos|presion|reifendruck|luftdruck|pression des pneus|pression|pressione (delle gomme|degli pneumatici|dei pneumatici)|pressione/,
  springs: /\bsprings?\b|\bmolas?\b|\bmuelles?\b|\bfedern?\b|\bressorts?\b|\bmoll[ae]\b/,
  bumpDamping: /\bbump (damping|setting|stiffness|clicks?)|(fast|slow|low[- ]speed|high[- ]speed) bump|compression damping|\bdamp(er|ers|ing)\b|\bshocks?\b|amortec|amortigu|dampfer|druckstufe|amortiss|ammortizz/,
  reboundDamping: /rebound|extensao|extension|zugstufe|detente|estensione/,
  antiRollBarFront: /(front|dianteir[ao]|delanter[ao]|vorder\w*) ?(anti[- ]?roll|arb|sway|barra|stabi)|(anti[- ]?roll bar|arb|barra estabilizadora|stabilisator|barre anti-?roulis|antiroulis|barra antirollio) (front|dianteir|delanter|vorne|avant|anterior)/,
  antiRollBarRear: /(rear|traseir[ao]|traser[ao]|hinter\w*) ?(anti[- ]?roll|arb|sway|barra|stabi)|(anti[- ]?roll bar|arb|barra estabilizadora|stabilisator|barre anti-?roulis|antiroulis|barra antirollio) (rear|traseir|traser|hinten|arriere|posterior)/,
  rideHeight: /ride height|\brake\b|altura (do carro|de rodagem|de manejo|libre)|bodenfreiheit|fahrhohe|hauteur de caisse|garde au sol|altezza (da terra|dal suolo)/,
  bumpStops: /bump ?stops?|batentes?|topes?|anschlagpuffer|butees?|tamponi|finecorsa/,
  camber: /camber|cambagem|caida|\bsturz\b|carrossage|campanatura/,
  // French "en avance" and "à l'avance" (early, in advance) aren't the caster
  caster: /caster|\bcaster\b|avanco|(?<!\ben |[ld]['’])avance|nachlauf|\bchasse\b|incidenza/,
  toe: /\btoe\b|convergencia|\bspur\b|pincement|parallelisme|convergenza/,
  rearWing: /\bwing\b|\basa\b|aleron|flugel|aileron|alettone/,
  frontSplitter: /splitter/,
  diffPreload: /preload|pre-?carga|vorspannung|precharge|precarico/,
  diffRamps: /\bdiff|differential|diferencial|differenzial|sperre|\bramps?\b/,
  brakePressure: /brake pressure|pressao de freio|presion de freno|bremsdruck|pression de frein\w*|pressione (del |dei |sul )?fren\w*/,
  brakeDucts: /brake ducts?|dutos? de freio|conductos? de freno|bremskuhlung|ecopes? de frein\w*|conduits? de frein\w*|prese d.?aria (dei )?freni|condotti (dei )?freni/,
};

const NEGATION = /\b(can'?t|cannot|can not|no|not|never|locked|without|nao|nunca|sin|nicht|kein\w*|nie|gesperrt|bloquead[oa]s?|travad[oa]s?|pas|jamais|sans|impossible|bloquee?s?|non|mai|senza|impossibile|bloccat[oaie])\b/;

// Generic anti-roll bar words with no end named, so either end counts
const ANY_ARB = /anti[- ]?roll|\barb\b|sway bar|barra estabilizadora|stabilisator|antiroulis|anti-roulis/;

export type GuardResult = { ok: boolean; disallowed: ParameterId[] };

export function checkSetupAnswer(text: string, allowed: Set<ParameterId>): GuardResult {
  const disallowed = new Set<ParameterId>();
  const sentences = normalize(text).split(/(?<=[.!?;])\s+|\n+/);
  for (const sentence of sentences) {
    if (NEGATION.test(sentence)) continue;
    for (const [parameter, re] of Object.entries(PARAMETER_TERMS) as [ParameterId, RegExp][]) {
      if (!re.test(sentence) || allowed.has(parameter)) continue;
      // "brake pressure" mentions brakes; "bias" in "brake bias" isn't tire pressure; skip overlaps with an allowed sibling
      if (parameter === 'tirePressure' && /brake pressure|pressao de freio|presion de freno|bremsdruck|pression de frein|pressione (del |dei |sul )?fren/.test(sentence)) continue;
      if (parameter === 'diffRamps' && allowed.has('diffPreload') && !/ramps?|sperre/.test(sentence)) continue;
      disallowed.add(parameter);
    }
    if (ANY_ARB.test(sentence) && !allowed.has('antiRollBarFront') && !allowed.has('antiRollBarRear')) {
      if (!disallowed.has('antiRollBarFront') && !disallowed.has('antiRollBarRear')) disallowed.add('antiRollBarFront');
    }
  }
  return { ok: disallowed.size === 0, disallowed: [...disallowed] };
}

// The answer without the sentences that recommend a parameter the car can't change; empty when nothing is left
export function withoutDisallowedSentences(text: string, allowed: Set<ParameterId>): string {
  const sentences = text.split(/(?<=[.!?;])\s+/);
  return sentences
    .filter((sentence) => checkSetupAnswer(sentence, allowed).ok)
    .join(' ')
    .trim();
}

export function setupGuardFeedback(result: GuardResult, fixed: boolean): string {
  const names = result.disallowed.map((p) => PARAMETER_LABELS[p]).join(', ');
  return fixed
    ? `Your answer suggests changing ${names}, which cannot be changed in a fixed-setup session. Rewrite it with only ` +
        'the in-car adjustments listed and driving changes.'
    : `Your answer suggests changing ${names}, which this car's setup does not have. Rewrite it with only the ` +
        'adjustments listed for this car and driving changes.';
}
