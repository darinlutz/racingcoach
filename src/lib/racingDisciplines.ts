// The kinds of racing a car is built for, stored in English in "Cars" and "CarsUsers".racing_discipline
// (labels: dictionary cars.disciplines)
export const RACING_DISCIPLINES = ['Sports Car', 'Prototype', 'Formula Car', 'Oval', 'Dirt Oval', 'Dirt Road'] as const;

export type RacingDiscipline = (typeof RACING_DISCIPLINES)[number];
