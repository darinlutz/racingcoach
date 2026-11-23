// The kinds of racing a car is built for (the Car Type), stored in English in "Cars".racing_discipline
// (labels: dictionary cars.disciplines). Cars stored under the earlier Oval and Dirt Road were moved once by
// recategorizeCars (defaultCars.ts)
export const RACING_DISCIPLINES = ['NASCAR', 'Sports Car', 'Prototype', 'Formula Car', 'Dirt Oval', 'Rallycross', 'Off-Road'] as const;

export type RacingDiscipline = (typeof RACING_DISCIPLINES)[number];
