import { NextResponse } from 'next/server';
import { isUniqueViolation } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { addCar, CarNotFoundError, carInputSchema, deleteCar, readCars, updateCar } from '@/lib/carData';

// Each signed-in user manages their own cars.
const NOT_SIGNED_IN = { error: 'Log in to manage your cars' };
const DUPLICATE = { error: 'You already have a car with that name' };

// The first validation problem, worded for the person filling in the form
function invalid(error: { issues: { message: string }[] }) {
  return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid car' }, { status: 400 });
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    return NextResponse.json({ cars: await readCars(user.id) });
  } catch (error) {
    console.error('Read cars error:', error);
    return NextResponse.json({ error: 'Failed to load cars' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const parsed = carInputSchema.safeParse(body.car);
    if (!parsed.success) return invalid(parsed.error);

    const id = await addCar(user.id, parsed.data);
    return NextResponse.json({ id, cars: await readCars(user.id) }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json(DUPLICATE, { status: 409 });
    console.error('Add car error:', error);
    return NextResponse.json({ error: 'Failed to add car' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (!Number.isInteger(body.id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const parsed = carInputSchema.safeParse(body.car);
    if (!parsed.success) return invalid(parsed.error);

    await updateCar(user.id, body.id, parsed.data);
    return NextResponse.json({ cars: await readCars(user.id) });
  } catch (error) {
    if (error instanceof CarNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (isUniqueViolation(error)) return NextResponse.json(DUPLICATE, { status: 409 });
    console.error('Update car error:', error);
    return NextResponse.json({ error: 'Failed to save car' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (!Number.isInteger(body.id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await deleteCar(user.id, body.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete car error:', error);
    return NextResponse.json({ error: 'Failed to delete car' }, { status: 500 });
  }
}
