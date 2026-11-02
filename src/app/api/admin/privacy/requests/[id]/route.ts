import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';
import { getDictionary } from '@/lib/i18n/server';
import { quietly, sendRequestUpdate } from '@/lib/privacyEmail';
import { enqueueJob, retryJob } from '@/lib/privacyJobs';
import {
  addEvent,
  addNote,
  getRequestForAdmin,
  isUuid,
  linkRequestToUser,
  transitionRequest,
  transitionWith,
  TransitionError,
} from '@/lib/privacyRequests';
import { cleanCategories, isRequestStatus } from '@/lib/privacyRules';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getUserByEmail } from '@/lib/users';

// Admin > Privacy Requests' actions on one request. Admins only; anyone else gets a 404, like the Admin page.
//   GET    the request with its whole history, jobs, exports and erasures
//   PATCH  { action, ... }:
//     transition  { to, resolution?, legalJustification?, retained? }  moves it (the requester is emailed when it's
//                 completed, rejected or extended)
//     note        { note, communication }  an internal note, or a record of a message sent to the requester
//     erase       { categories }  erases categories of the linked account (e.g. reviewed ones the Admin approved)
//     export      { exportKind }  makes an export for the linked account
//     retryJob    { jobId }
//     link        { email }  links a request made without signing in to the account with that address

type Params = { params: Promise<{ id: string }> };

const TEXT_LIMIT = 5000;
const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, TEXT_LIMIT) : '');

export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { id } = await params;
  const detail = await getRequestForAdmin(id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const t = getDictionary(user.preferredLanguage).privacyAdmin.errors;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const body = await request.json().catch(() => ({}));
    const detail = await getRequestForAdmin(id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const current = detail.request;

    switch (body.action) {
      case 'transition': {
        if (!isRequestStatus(body.to)) return NextResponse.json({ error: t.notAllowed }, { status: 400 });
        const retained = Array.isArray(body.retained)
          ? body.retained
              .map((item: { category?: unknown; reason?: unknown }) => ({ category: text(item?.category), reason: text(item?.reason) }))
              .filter((item: { category: string; reason: string }) => item.category && item.reason)
              .slice(0, 30)
          : undefined;
        const moved = await transitionRequest(id, {
          to: body.to,
          actor: 'admin',
          actorId: user.id,
          resolution: text(body.resolution) || null,
          legalJustification: text(body.legalJustification) || null,
          retained,
        });
        const email = current.accountEmail ?? current.requesterEmail;
        if (email && ['completed', 'rejected', 'extended'].includes(moved.status)) {
          await quietly(
            sendRequestUpdate(email, {
              requestId: moved.id,
              type: moved.type,
              headline: moved.status === 'extended' ? 'the deadline was extended' : moved.status,
              message: moved.status === 'extended' ? moved.extensionReason : moved.resolution,
              signedIn: current.userId !== null,
            }),
            'status update'
          );
        }
        return NextResponse.json({ request: moved });
      }
      case 'note': {
        const note = text(body.note);
        if (!note) return NextResponse.json({ error: t.failed }, { status: 400 });
        await addNote(id, { actorId: user.id, note, communication: body.communication === true });
        return NextResponse.json({ ok: true });
      }
      case 'erase':
      case 'export': {
        if (current.userId === null) return NextResponse.json({ error: t.noAccount }, { status: 400 });
        const categories = cleanCategories(body.categories);
        if (body.action === 'erase' && categories.length === 0) return NextResponse.json({ error: t.failed }, { status: 400 });
        await transaction(async (client) => {
          if (body.action === 'erase') {
            await enqueueJob(client, id, 'erasure', { categories });
          } else {
            await enqueueJob(client, id, 'export', { exportKind: body.exportKind === 'portability' ? 'portability' : 'access' });
          }
          await addEvent(client, id, {
            actor: 'admin',
            actorId: user.id,
            event: body.action === 'erase' ? 'erasureApproved' : 'exportQueued',
            note: body.action === 'erase' ? categories.join(', ') : null,
          });
          if (['submitted', 'in_review', 'extended'].includes(current.status)) {
            await transitionWith(client, id, { to: 'processing', actor: 'admin', actorId: user.id });
          }
        });
        return NextResponse.json({ ok: true });
      }
      case 'retryJob': {
        const jobId = Number(body.jobId);
        const [job] = Number.isInteger(jobId) ? await query('SELECT request_id FROM racingcoach."PrivacyJobs" WHERE id = $1', [jobId]) : [];
        if (!job || job.request_id !== id || !(await retryJob(jobId))) return NextResponse.json({ error: t.failed }, { status: 400 });
        await addNote(id, { actorId: user.id, note: `Retried job ${jobId}`, communication: false });
        return NextResponse.json({ ok: true });
      }
      case 'link': {
        const account = typeof body.email === 'string' ? await getUserByEmail(body.email.trim()) : null;
        if (!account) return NextResponse.json({ error: t.noSuchAccount }, { status: 400 });
        if (!(await linkRequestToUser(id, account.id, user.id))) return NextResponse.json({ error: t.notAllowed }, { status: 400 });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: t.failed }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof TransitionError) {
      const message = error.reason === 'notFound' ? 'Not found' : t[error.reason];
      return NextResponse.json({ error: message }, { status: error.reason === 'notFound' ? 404 : 400 });
    }
    console.error('Privacy admin action error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
