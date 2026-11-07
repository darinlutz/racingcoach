import { NextResponse } from 'next/server';
import { isUniqueViolation } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { addCar, CarNotFoundError, carInputSchema, deleteCar, readCars, updateCar } from '@/lib/carData';
import { apiText } from '@/lib/i18n/server';
import { readJsonLimited } from '@/lib/requestBody';
import { canEditCars } from '@/lib/roles';

// The one list of cars, for any signed-in user to read. Only Coaches and Admins can change it; anyone else's POST, PUT
// or DELETE gets a 404, like the Coach page's routes.

// The first validation problem, worded for the person filling in the form
function invalid(error: { issues: { message: string }[] }) {
  return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid car' }, { status: 400 });
}

export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInCars }, { status: 401 });
    }
    return NextResponse.json({ cars: await readCars() });
  } catch (error) {
    console.error('Read cars error:', error);
    return NextResponse.json({ error: t.failedLoadCars }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInCars }, { status: 401 });
    }
    if (!canEditCars(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const body = await readJsonLimited(request, 256 * 1024).catch(() => ({}));
    const parsed = carInputSchema.safeParse(body.car);
    if (!parsed.success) return invalid(parsed.error);

    const id = await addCar(parsed.data);
    return NextResponse.json({ id, cars: await readCars() }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: t.carNameTaken }, { status: 409 });
    console.error('Add car error:', error);
    return NextResponse.json({ error: t.failedAddCar }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInCars }, { status: 401 });
    }
    if (!canEditCars(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const body = await readJsonLimited(request, 256 * 1024).catch(() => ({}));
    if (!Number.isInteger(body.id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const parsed = carInputSchema.safeParse(body.car);
    if (!parsed.success) return invalid(parsed.error);

    await updateCar(body.id, parsed.data);
    return NextResponse.json({ cars: await readCars() });
  } catch (error) {
    if (error instanceof CarNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (isUniqueViolation(error)) return NextResponse.json({ error: t.carNameTaken }, { status: 409 });
    console.error('Update car error:', error);
    return NextResponse.json({ error: t.failedSaveCar }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInCars }, { status: 401 });
    }
    if (!canEditCars(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const body = await readJsonLimited(request, 256 * 1024).catch(() => ({}));
    if (!Number.isInteger(body.id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await deleteCar(body.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete car error:', error);
    return NextResponse.json({ error: t.failedDeleteCar }, { status: 500 });
  }
}
