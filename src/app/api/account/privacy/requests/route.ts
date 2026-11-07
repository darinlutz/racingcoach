import { NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';
import { fmt, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { notifyOwnerOfRequest, quietly } from '@/lib/privacyEmail';
import { enqueueJob } from '@/lib/privacyJobs';
import { countOpenRequests, createRequest, listRequestsForUser, transitionWith, type RequestScope } from '@/lib/privacyRequests';
import {
  cleanCategories,
  isRequestType,
  MAX_DETAILS_LENGTH,
  MAX_EXPORTS_PER_DAY,
  MAX_OPEN_REQUESTS,
  needsReview,
  requestReference,
  SUBMITTABLE_TYPES,
  type RequestType,
} from '@/lib/privacyRules';
import { isRecentlyReauthenticated } from '@/lib/reauth';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { getCurrentUser } from '@/lib/session';

// The signed-in user's own privacy requests (Privacy & Data Rights).
//   GET   their requests, newest first
//   POST  { type, details?, exportKind?, categories?, corrections? } submits one:
//         access / portability  makes an export in the background (needs "Confirm it's you")
//         erasure               deletes the chosen categories in the background (needs it too); reviewed ones wait for an Admin
//         rectification, restriction, objection, other  go to an Admin
// Every request is about the signed-in account only; nothing here takes a user ID.

const TEXT_LIMIT = 500;

function cleanCorrections(value: unknown): RequestScope['corrections'] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 10)
    .map((item) => ({
      field: typeof item?.field === 'string' ? item.field.trim().slice(0, TEXT_LIMIT) : '',
      current: typeof item?.current === 'string' ? item.current.trim().slice(0, TEXT_LIMIT) : '',
      corrected: typeof item?.corrected === 'string' ? item.corrected.trim().slice(0, TEXT_LIMIT) : '',
    }))
    .filter((item) => item.field && item.corrected);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: getDictionary('en').privacyRights.errors.logIn }, { status: 401 });
  const requests = await listRequestsForUser(user.id);
  // The Admin's legal justification is internal, never shown to the requester
  return NextResponse.json({ requests: requests.map((request) => ({ ...request, legalJustification: undefined })) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = getDictionary(user?.preferredLanguage ?? 'en').privacyRights;
  try {
    if (!user) return NextResponse.json({ error: t.errors.logIn }, { status: 401 });
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => ({}));
    const type = body.type as RequestType;
    if (!isRequestType(type) || !SUBMITTABLE_TYPES.includes(type)) {
      return NextResponse.json({ error: t.errors.invalidType }, { status: 400 });
    }
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (details.length > MAX_DETAILS_LENGTH) {
      return NextResponse.json({ error: fmt(t.errors.tooLong, { max: MAX_DETAILS_LENGTH }) }, { status: 400 });
    }
    if ((await countOpenRequests(user.id)) >= MAX_OPEN_REQUESTS) {
      return NextResponse.json({ error: t.errors.tooManyOpen }, { status: 429 });
    }

    const exportRequest = type === 'access' || type === 'portability';
    const categories = type === 'erasure' ? cleanCategories(body.categories) : [];
    const corrections = type === 'rectification' ? cleanCorrections(body.corrections) : [];
    if (type === 'erasure' && categories.length === 0) {
      return NextResponse.json({ error: t.erase.nothingChosen }, { status: 400 });
    }
    if (['restriction', 'objection', 'other'].includes(type) && !details) {
      return NextResponse.json({ error: t.errors.detailsRequired }, { status: 400 });
    }
    if (type === 'rectification' && corrections!.length === 0 && !details) {
      return NextResponse.json({ error: t.errors.detailsRequired }, { status: 400 });
    }
    // Taking a copy of the data or deleting it needs the step-up sign-in
    const sensitive = exportRequest || type === 'erasure';
    if (sensitive && !(await isRecentlyReauthenticated(user))) {
      return NextResponse.json({ error: t.reauth.required, reauthRequired: true }, { status: 403 });
    }
    if (exportRequest) {
      const [{ n }] = await query(
        `SELECT count(*)::int AS n FROM racingcoach."PrivacyRequests"
         WHERE user_id = $1 AND request_type IN ('access', 'portability') AND submitted_at > now() - interval '1 day'`,
        [user.id]
      );
      if (Number(n) >= MAX_EXPORTS_PER_DAY) {
        return NextResponse.json({ error: fmt(t.errors.tooManyExports, { max: MAX_EXPORTS_PER_DAY }) }, { status: 429 });
      }
    }

    const automatic = categories.filter((category) => !needsReview(category));
    const created = await transaction(async (client) => {
      const scope: RequestScope = exportRequest
        ? { exportKind: type }
        : type === 'erasure'
          ? { categories }
          : type === 'rectification'
            ? { corrections }
            : {};
      const privacyRequest = await createRequest(client, {
        userId: user.id,
        requesterName: user.userName,
        requesterEmail: user.emailAddress,
        type,
        details,
        scope,
        verifiedBy: sensitive ? 'reauth' : 'session',
      });
      if (exportRequest) {
        await enqueueJob(client, privacyRequest.id, 'export', { exportKind: type });
        return transitionWith(client, privacyRequest.id, { to: 'processing', actor: 'system' });
      }
      if (type === 'erasure' && automatic.length) {
        await enqueueJob(client, privacyRequest.id, 'erasure', { categories: automatic });
        return transitionWith(client, privacyRequest.id, { to: 'processing', actor: 'system' });
      }
      if (type === 'erasure') {
        return transitionWith(client, privacyRequest.id, { to: 'in_review', actor: 'system' });
      }
      return privacyRequest;
    });

    // An Admin is needed for anything that isn't done automatically
    const review = !exportRequest && !(type === 'erasure' && automatic.length === categories.length);
    if (review) {
      await quietly(notifyOwnerOfRequest({ requestId: created.id, type, review: true }), 'owner notice');
    }
    const locale = LANGUAGE_LOCALES[user.preferredLanguage];
    return NextResponse.json(
      {
        request: { id: created.id, status: created.status, type: created.type, dueAt: created.dueAt },
        message: fmt(t.submit.submitted, {
          reference: requestReference(created.id),
          date: created.dueAt.toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' }),
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Privacy request error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.errors.failed }, { status: 500 });
  }
}
