import { z } from 'zod';
import { query } from './db';
import { RACING_DISCIPLINES } from './racingDisciplines';
import { ensureUserSchema } from './users';

// The cars in racingcoach."Cars" (created by ensureUserSchema): one list shared by everyone, kept by Coaches and Admins.

const measure = z.number().positive().max(100000).nullable();
const whole = z.number().int().positive().max(100000).nullable();

export const carInputSchema = z.object({
  name: z.string().trim().min(1, 'Car name is required').max(200),
  racingDiscipline: z.enum(RACING_DISCIPLINES).nullable(),
  lengthIn: measure,
  widthIn: measure,
  wheelbaseIn: measure,
  dryWeightLbs: whole,
  wetWeightLbs: whole,
  displacementLiters: measure,
  rpmLimit: whole,
  torqueLbFt: whole,
  powerBhp: whole,
  notes: z
    .string()
    .max(5000)
    .transform((s) => s.trim() || null)
    .nullable(),
});

export type CarInput = z.infer<typeof carInputSchema>;
export type Car = CarInput & { id: number };

// The rpm limit of a car by name, from Car Data. iRacing's car names can differ a little from Car Data's, so case and
// punctuation are ignored and one name containing the other also matches. null when no car matches or it has no rpm
// limit.
export async function carRpmLimit(carName: string): Promise<number | null> {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = key(carName);
  if (!wanted) return null;
  const cars = await readCars();
  const match =
    cars.find((car) => key(car.name) === wanted) ??
    cars.find((car) => key(car.name).length > 0 && (wanted.includes(key(car.name)) || key(car.name).includes(wanted)));
  return match?.rpmLimit ?? null;
}

export class CarNotFoundError extends Error {
  constructor() {
    super('Car not found');
  }
}

const CAR_COLUMNS = `car_name, racing_discipline, length_in, width_in, wheelbase_in, dry_weight_lbs, wet_weight_lbs,
  displacement_liters, rpm_limit, torque_lb_ft, power_bhp, notes`;

const carValues = (car: CarInput) => [
  car.name,
  car.racingDiscipline,
  car.lengthIn,
  car.widthIn,
  car.wheelbaseIn,
  car.dryWeightLbs,
  car.wetWeightLbs,
  car.displacementLiters,
  car.rpmLimit,
  car.torqueLbFt,
  car.powerBhp,
  car.notes,
];

export async function readCars(): Promise<Car[]> {
  await ensureUserSchema();
  const rows = await query(`SELECT id, ${CAR_COLUMNS} FROM racingcoach."Cars" ORDER BY lower(car_name)`);
  return rows.map((r) => ({
    id: r.id as number,
    name: r.car_name as string,
    racingDiscipline: r.racing_discipline as CarInput['racingDiscipline'],
    lengthIn: r.length_in as number | null,
    widthIn: r.width_in as number | null,
    wheelbaseIn: r.wheelbase_in as number | null,
    dryWeightLbs: r.dry_weight_lbs as number | null,
    wetWeightLbs: r.wet_weight_lbs as number | null,
    displacementLiters: r.displacement_liters as number | null,
    rpmLimit: r.rpm_limit as number | null,
    torqueLbFt: r.torque_lb_ft as number | null,
    powerBhp: r.power_bhp as number | null,
    notes: r.notes as string | null,
  }));
}

// Throws a unique violation (see isUniqueViolation) when there's already a car with that name
export async function addCar(car: CarInput): Promise<number> {
  await ensureUserSchema();
  const [row] = await query(
    `INSERT INTO racingcoach."Cars" (${CAR_COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    carValues(car)
  );
  return row.id as number;
}

export async function updateCar(id: number, car: CarInput): Promise<void> {
  await ensureUserSchema();
  const rows = await query(
    `UPDATE racingcoach."Cars" SET car_name = $2, racing_discipline = $3, length_in = $4, width_in = $5,
       wheelbase_in = $6, dry_weight_lbs = $7, wet_weight_lbs = $8, displacement_liters = $9, rpm_limit = $10,
       torque_lb_ft = $11, power_bhp = $12, notes = $13, updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id, ...carValues(car)]
  );
  if (rows.length === 0) throw new CarNotFoundError();
}

// A Broadcast Video tagged with this car keeps playing, without the tag (ON DELETE SET NULL)
export async function deleteCar(id: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."Cars" WHERE id = $1', [id]);
}
