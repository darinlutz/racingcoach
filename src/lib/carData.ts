import { z } from 'zod';
import { query } from './db';
import { DEFAULT_CARS } from './defaultCars';
import { ensureUserSchema } from './users';

// Each user's own cars in racingcoach."CarsUsers" (created by ensureUserSchema and copied from the
// default cars in racingcoach."Cars" when the account is created).

const measure = z.number().positive().max(100000).nullable();
const whole = z.number().int().positive().max(100000).nullable();

export const carInputSchema = z.object({
  name: z.string().trim().min(1, 'Car name is required').max(200),
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
export type UserCar = CarInput & { id: number };

// The rpm limit of a car by name, from the user's Car Data, or the default cars for someone not signed in.
// iRacing's car names can differ a little from Car Data's, so case and punctuation are ignored and one name
// containing the other also matches. null when no car matches or it has no rpm limit.
export async function carRpmLimit(userId: number | null, carName: string): Promise<number | null> {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = key(carName);
  if (!wanted) return null;
  const cars: { name: string; rpmLimit: number | null }[] = userId === null ? DEFAULT_CARS : await readCars(userId);
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

const CAR_COLUMNS = `car_name, length_in, width_in, wheelbase_in, dry_weight_lbs, wet_weight_lbs,
  displacement_liters, rpm_limit, torque_lb_ft, power_bhp, notes`;

const carValues = (car: CarInput) => [
  car.name,
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

export async function readCars(userId: number): Promise<UserCar[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT id, ${CAR_COLUMNS} FROM racingcoach."CarsUsers" WHERE user_id = $1 ORDER BY lower(car_name)`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id as number,
    name: r.car_name as string,
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

// Throws a unique violation (see isUniqueViolation) when the user already has a car with that name
export async function addCar(userId: number, car: CarInput): Promise<number> {
  await ensureUserSchema();
  const [row] = await query(
    `INSERT INTO racingcoach."CarsUsers" (user_id, ${CAR_COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [userId, ...carValues(car)]
  );
  return row.id as number;
}

// Only updates the car if it belongs to this user
export async function updateCar(userId: number, id: number, car: CarInput): Promise<void> {
  await ensureUserSchema();
  const rows = await query(
    `UPDATE racingcoach."CarsUsers" SET car_name = $3, length_in = $4, width_in = $5, wheelbase_in = $6,
       dry_weight_lbs = $7, wet_weight_lbs = $8, displacement_liters = $9, rpm_limit = $10,
       torque_lb_ft = $11, power_bhp = $12, notes = $13, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId, ...carValues(car)]
  );
  if (rows.length === 0) throw new CarNotFoundError();
}

// Only deletes the car if it belongs to this user
export async function deleteCar(userId: number, id: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."CarsUsers" WHERE id = $1 AND user_id = $2', [id, userId]);
}
