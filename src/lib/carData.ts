import { z } from 'zod';
import { query } from './db';
import { ensureUserSchema } from './users';

// Each user's own cars in racingcoach."CarData" (created by ensureUserSchema and seeded with
// DEFAULT_CARS from lib/defaultCars when the account is created).

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
    `SELECT id, ${CAR_COLUMNS} FROM racingcoach."CarData" WHERE user_id = $1 ORDER BY lower(car_name)`,
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
    `INSERT INTO racingcoach."CarData" (user_id, ${CAR_COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [userId, ...carValues(car)]
  );
  return row.id as number;
}

// Only updates the car if it belongs to this user
export async function updateCar(userId: number, id: number, car: CarInput): Promise<void> {
  await ensureUserSchema();
  const rows = await query(
    `UPDATE racingcoach."CarData" SET car_name = $3, length_in = $4, width_in = $5, wheelbase_in = $6,
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
  await query('DELETE FROM racingcoach."CarData" WHERE id = $1 AND user_id = $2', [id, userId]);
}
