import { NextResponse } from 'next/server';
import { isUniqueViolation } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { addTrack, deleteTrack, readTracks, TrackNotFoundError, trackInputSchema, updateTrack } from '@/lib/tracks';

// Each signed-in user manages their own tracks and focus areas.
const NOT_SIGNED_IN = { error: 'Log in to manage your tracks' };
const DUPLICATE = { error: 'You already have a track with that name or key' };

// The first validation problem, worded for the person filling in the form
function invalid(error: { issues: { message: string }[] }) {
  return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid track' }, { status: 400 });
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    return NextResponse.json({ tracks: await readTracks(user.id) });
  } catch (error) {
    console.error('Read tracks error:', error);
    return NextResponse.json({ error: 'Failed to load tracks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const parsed = trackInputSchema.safeParse(body.track);
    if (!parsed.success) return invalid(parsed.error);

    const id = await addTrack(user.id, parsed.data);
    return NextResponse.json({ id, tracks: await readTracks(user.id) }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json(DUPLICATE, { status: 409 });
    console.error('Add track error:', error);
    return NextResponse.json({ error: 'Failed to add track' }, { status: 500 });
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
    const parsed = trackInputSchema.safeParse(body.track);
    if (!parsed.success) return invalid(parsed.error);

    await updateTrack(user.id, body.id, parsed.data);
    return NextResponse.json({ tracks: await readTracks(user.id) });
  } catch (error) {
    if (error instanceof TrackNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (isUniqueViolation(error)) return NextResponse.json(DUPLICATE, { status: 409 });
    console.error('Update track error:', error);
    return NextResponse.json({ error: 'Failed to save track' }, { status: 500 });
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

    await deleteTrack(user.id, body.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete track error:', error);
    return NextResponse.json({ error: 'Failed to delete track' }, { status: 500 });
  }
}
