import {
  siAcura,
  siAstonmartin,
  siAudi,
  siBentley,
  siBmw,
  siCadillac,
  siChevrolet,
  siFerrari,
  siFord,
  siHonda,
  siHyundai,
  siKia,
  siLamborghini,
  siMazda,
  siMclaren,
  siMini,
  siNissan,
  siPeugeot,
  siPorsche,
  siRenault,
  siSubaru,
  siToyota,
  siVolkswagen,
} from 'simple-icons';

// The maker of an iRacing car, from its name in session info (e.g. "Porsche 911 GT3 R (992)", "NASCAR Cup Series Next
// Gen Chevrolet Camaro ZL1"), with its logo as one 24 x 24 SVG path (simple-icons, drawn in one color), for Live
// Racing's leaderboard. Makers simple-icons doesn't have (Dallara, Ligier, Radical...) give null. Mercedes' star isn't
// in simple-icons either, so it's drawn here: the ring, and the star's three blades.
export type CarBrand = { name: string; path: string };

const MERCEDES_PATH =
  'M12 .5a11.5 11.5 0 1 0 0 23a11.5 11.5 0 1 0 0-23Zm0 1.5a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z' +
  'M12 2L13.56 11.1L20.66 17L12 13.8L3.34 17L10.44 11.1Z';

const icon = (si: { title: string; path: string }): CarBrand => ({ name: si.title, path: si.path });

// Checked in order; the words are matched whole, ignoring case and accents
const BRANDS: [RegExp, CarBrand][] = [
  [/\b(mercedes|amg)\b/, { name: 'Mercedes-Benz', path: MERCEDES_PATH }],
  [/\bporsche\b/, icon(siPorsche)],
  [/\bmclaren\b/, icon(siMclaren)],
  [/\bferrari\b/, icon(siFerrari)],
  [/\bbmw\b/, icon(siBmw)],
  [/\baudi\b/, icon(siAudi)],
  [/\blamborghini\b/, icon(siLamborghini)],
  [/\baston martin\b/, icon(siAstonmartin)],
  [/\bacura\b/, icon(siAcura)],
  [/\bcadillac\b/, icon(siCadillac)],
  [/\b(chevrolet|chevy|corvette|camaro|silverado)\b/, icon(siChevrolet)],
  [/\b(ford|mustang)\b/, icon(siFord)],
  [/\b(toyota|gr86|supra|tundra)\b/, icon(siToyota)],
  [/\bmazda\b/, icon(siMazda)],
  [/\bhonda\b/, icon(siHonda)],
  [/\bhyundai\b/, icon(siHyundai)],
  [/\bkia\b/, icon(siKia)],
  [/\bnissan\b/, icon(siNissan)],
  [/\bsubaru\b/, icon(siSubaru)],
  [/\b(volkswagen|vw)\b/, icon(siVolkswagen)],
  [/\brenault\b/, icon(siRenault)],
  [/\bpeugeot\b/, icon(siPeugeot)],
  [/\bmini\b/, icon(siMini)],
  [/\bbentley\b/, icon(siBentley)],
];

const plainName = (car: string) => car.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function carBrand(car: string | null | undefined): CarBrand | null {
  if (!car) return null;
  const name = plainName(car);
  return BRANDS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

// Cars a broadcast calls by the model rather than the maker; checked before the maker
const SPOKEN_MODELS: [RegExp, string][] = [
  [/\bcorvette\b/, 'Corvette'],
  [/\bcamaro\b/, 'Camaro'],
  [/\bmustang\b/, 'Mustang'],
];
// Makers whose simple-icons title isn't what a broadcast says
const SPOKEN_MAKERS: Record<string, string> = { 'Mercedes-Benz': 'Mercedes', MINI: 'Mini' };

// What the Race Announcers call a car: "McLaren" for the McLaren 720S GT3 EVO, "Corvette" for the Chevrolet Corvette
// Z06 GT3.R, else the maker, else the first word of the name (e.g. "Dallara" for the Dallara P217)
export function spokenCarName(car: string): string {
  const name = plainName(car);
  const model = SPOKEN_MODELS.find(([pattern]) => pattern.test(name))?.[1];
  if (model) return model;
  const maker = carBrand(car)?.name;
  if (maker) return SPOKEN_MAKERS[maker] ?? maker;
  return car.trim().split(/\s+/)[0] ?? car;
}
