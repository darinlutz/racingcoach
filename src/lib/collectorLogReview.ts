import { createAgent } from 'langchain';
import { z } from 'zod';
import { chatModel } from './aiModels';
import { query } from './db';
import { getUserById, OWNER_EMAIL } from './users';

// The collector log review agent. When a batch of a user's collector activity log (racingcoach."CollectorLogs")
// arrives with lines that look like trouble, it waits for the lines around them, then has the AI read the run's
// recent lines and decide whether something is really wrong. If it is, the site owner gets an email with the
// subject "COLLECTOR ERROR", what went wrong and how it could be fixed. Each review is kept in
// racingcoach."CollectorLogReviews" (shown in the Admin page's Collector Logs section), so the same lines aren't
// reviewed twice and a problem already emailed for a run isn't emailed again.

export const EMAIL_SUBJECT = 'COLLECTOR ERROR';

// Waits this long after a suspicious line, so the lines that follow it (sent every 15 s) are part of the review
const REVIEW_DELAY_MS = 90_000;
// The run's lines the agent reads: the newest, up to this many
const CONTEXT_LINES = 200;
// At most this many emails a day, however many problems come in
const MAX_EMAILS_PER_DAY = 20;

// Lines worth a review: errors, and messages that say something failed (the collector doesn't mark them all)
const SUSPICIOUS =
  /could ?n[o'’]t|failed|failure|error|exception|isn[o'’]?t available|not available|stopped|timed out|refused|no longer accepts|did not accept|unauthori[sz]ed|crash|no feedback/i;

export function isSuspicious(line: { message: string; isError: boolean }): boolean {
  return line.isError || SUSPICIOUS.test(line.message);
}

// One pending review per run; a later suspicious batch of the same run just joins it
const pending = new Map<string, ReturnType<typeof setTimeout>>();

// Called after each batch is stored; never throws
export function scheduleCollectorLogReview(userId: number, runId: string, lines: { message: string; isError: boolean }[]): void {
  if (!lines.some(isSuspicious)) return;
  const key = `${userId}:${runId}`;
  if (pending.has(key)) return;
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      reviewCollectorRun(userId, runId).catch((error) => console.error('Collector log review error:', error));
    }, REVIEW_DELAY_MS)
  );
}

const verdictSchema = z.object({
  problem: z
    .boolean()
    .describe('True only for a real problem that needs fixing and has not already been reported for this run'),
  title: z.string().describe('A short name for the problem, e.g. "Coach voice requests failing"; empty when there is no problem'),
  explanation: z
    .string()
    .describe('What went wrong, in plain words: what the driver noticed or missed, which part failed and why, quoting the log lines that show it. Empty when there is no problem'),
  fix: z
    .string()
    .describe('How it could be fixed: what the driver can do on their PC or Account page, and what the site owner can change (settings, environment variables, Render, or code, naming the files). Empty when there is no problem'),
});

type Verdict = z.infer<typeof verdictSchema>;

const SYSTEM_PROMPT = `You review the activity log of the RacingCoach Collector, a Windows app (C#, WPF) that reads live iRacing telemetry, saves each lap as a CSV and uploads it to the RacingCoach website (Next.js on Render, PostgreSQL, OpenAI). Decide whether the newest lines show a real problem, and if so explain it and how to fix it, for the site owner, who wrote the app.

What the collector does, and the log messages that go with it:
- Upload key: the user's key from the Account page's Telemetry Collector card. "doesn't accept the upload key" / "no longer accepts" means it was replaced or deleted: the driver enters the new one with the Upload Key button. Code: CollectorSettings.cs, UploadSetup.cs, src/app/api/collector/key, src/lib/collectorKeys.ts.
- Lap uploads (LapUploader.cs, POST /api/collector/laps, src/lib/collectorLaps.ts): "Could not upload" with a retry is usually the site being unreachable or restarting; refused laps are a data or server problem.
- In-Car AI Coach (InCarCoach.cs, src/lib/inCarCoach.ts, src/app/api/collector/in-car-coach/route.ts): "In-Car Coach couldn't load your instructions" is the GET plan request failing (often OPENAI_API_KEY, or a model picked in the Admin page's AI Model Control that doesn't support structured output); "In-Car Coach had no feedback after N laps: <error>" is the POST callouts request failing. "nothing new to say" is not an error.
- Coach voice (Voice.cs, POST /api/collector/speech, src/lib/coachVoice.ts, Google Chirp 3 HD, or OpenAI gpt-4o-mini-tts without GOOGLE_TTS_API_KEY): "The coach voice isn't available" means speech requests are failing and Windows' voice is used instead. "The coach couldn't say" means playing sound failed on the PC (audio device).
- Track positions (IbtEnricher.cs, IbtFile.cs): added from iRacing's .ibt files after each stint; laps the .ibt doesn't cover are normal.
- Overlay and Target Telemetry window (OverlayEngine.cs runs scripts/TelemetryEngine.js in Jint; TargetLapSource.cs, GET /api/collector/target-lap; GET /api/collector/track): script errors, or Track Data missing for the track.
- Brake beeps (BrakeBeeps.cs, TonePlayer.cs, GET /api/collector/brake-beeps): waveOut errors mean no sound device.
- Race results (RaceResults.cs, POST /api/collector/race-result), the in-session debrief (SessionDebrief.cs, POST /api/collector/debrief).
- Updates (UpdateCheck.cs, SelfUpdater.cs, GitHub releases): failed downloads or installs.
- "The collector stopped: ..." means the telemetry loop crashed: always a problem.

Not problems: waiting for iRacing, connecting and disconnecting, played-back files, the site being briefly unreachable when a later line shows it recovered, a single retry that then succeeds, laps without track positions, and anything already listed as reported for this run (set problem to false unless it got worse or a different problem appears). Use only what the log shows; never invent details. Plain text, no markdown.`;

type LogLine = { seq: number; loggedAt: string; isError: boolean; message: string; version: string | null };

// Reviews a run's lines since its last review, records the verdict, and emails a problem; exported for tests
export async function reviewCollectorRun(userId: number, runId: string): Promise<Verdict | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not configured; collector log review skipped');
    return null;
  }
  const reviewed = await query<{ to_seq: number | null }>(
    'SELECT max(to_seq) AS to_seq FROM racingcoach."CollectorLogReviews" WHERE user_id = $1 AND run_id = $2',
    [userId, runId]
  );
  const afterSeq = reviewed[0]?.to_seq ?? 0;

  const rows = await query<{ seq: number; logged_at: Date; is_error: boolean; message: string; collector_version: string | null }>(
    `SELECT seq, logged_at, is_error, message, collector_version FROM racingcoach."CollectorLogs"
     WHERE user_id = $1 AND run_id = $2 ORDER BY seq DESC LIMIT $3`,
    [userId, runId, CONTEXT_LINES]
  );
  const lines: LogLine[] = rows.reverse().map((row) => ({
    seq: row.seq,
    loggedAt: row.logged_at.toISOString(),
    isError: row.is_error,
    message: row.message,
    version: row.collector_version,
  }));
  const fresh = lines.filter((line) => line.seq > afterSeq);
  if (fresh.length === 0 || !fresh.some(isSuspicious)) return null;

  const earlier = await query<{ title: string }>(
    `SELECT title FROM racingcoach."CollectorLogReviews"
     WHERE user_id = $1 AND run_id = $2 AND problem AND title IS NOT NULL ORDER BY reviewed_at`,
    [userId, runId]
  );

  const agent = createAgent({
    model: await chatModel('collectorLogReview', 0),
    tools: [],
    systemPrompt: SYSTEM_PROMPT,
    responseFormat: verdictSchema,
  });
  const format = (line: LogLine) =>
    `${line.seq > afterSeq ? '*' : ' '} #${line.seq} ${line.loggedAt} ${line.isError ? 'ERROR ' : ''}${line.message}`;
  const result = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: [
          `Collector version ${fresh[fresh.length - 1].version ?? 'unknown'}. Run ${runId}.`,
          earlier.length > 0
            ? `Already reported for this run: ${earlier.map((r) => `"${r.title}"`).join(', ')}.`
            : 'Nothing has been reported for this run yet.',
          'The run\'s latest log lines, oldest first; the new lines to review are marked with *:',
          ...lines.map(format),
        ].join('\n'),
      },
    ],
  });
  const verdict = result.structuredResponse as Verdict;

  const saved = await query<{ id: string }>(
    `INSERT INTO racingcoach."CollectorLogReviews" (user_id, run_id, from_seq, to_seq, problem, title, explanation, fix)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      userId,
      runId,
      fresh[0].seq,
      fresh[fresh.length - 1].seq,
      verdict.problem,
      verdict.problem ? verdict.title.trim() || 'Collector problem' : null,
      verdict.problem ? verdict.explanation.trim() : null,
      verdict.problem ? verdict.fix.trim() : null,
    ]
  );
  console.log(`Collector log review: user ${userId}, run ${runId}, lines ${fresh[0].seq}-${fresh[fresh.length - 1].seq}: ${verdict.problem ? verdict.title : 'no problem'}`);

  if (verdict.problem && (await emailProblem(userId, runId, verdict, fresh))) {
    await query('UPDATE racingcoach."CollectorLogReviews" SET emailed_at = now() WHERE id = $1', [saved[0].id]);
  }
  return verdict;
}

// Emails the site owner about a problem; false when it wasn't sent
async function emailProblem(userId: number, runId: string, verdict: Verdict, fresh: LogLine[]): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('Resend API key not configured. Collector error email skipped:', verdict.title);
    return false;
  }
  const today = await query<{ count: string }>(
    `SELECT count(*) AS count FROM racingcoach."CollectorLogReviews" WHERE emailed_at > now() - interval '1 day'`
  );
  if (Number(today[0].count) >= MAX_EMAILS_PER_DAY) {
    console.error(`Collector error email skipped (${MAX_EMAILS_PER_DAY} sent in the last day):`, verdict.title);
    return false;
  }

  const user = await getUserById(userId);
  const siteUrl = process.env.SITE_URL?.trim().replace(/\/+$/, '');
  const errorLines = fresh.filter(isSuspicious).slice(-15);
  const text = [
    `The collector log review agent found a problem: ${verdict.title}`,
    '',
    `User: ${user ? `${user.userName} (${user.emailAddress}), #${userId}` : `#${userId}`}`,
    `Collector version: ${fresh[fresh.length - 1].version ?? 'unknown'}`,
    `Run: ${runId}`,
    `When: ${fresh[0].loggedAt} to ${fresh[fresh.length - 1].loggedAt}`,
    '',
    'WHAT WENT WRONG',
    verdict.explanation,
    '',
    'HOW IT COULD BE FIXED',
    verdict.fix,
    '',
    'LOG LINES',
    ...errorLines.map((line) => `#${line.seq} ${line.loggedAt} ${line.isError ? 'ERROR ' : ''}${line.message}`),
    ...(siteUrl ? ['', `The whole run: ${siteUrl}/admin?logUser=${userId}&logRun=${runId}#collector-logs`] : []),
  ].join('\n');

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: OWNER_EMAIL,
        subject: EMAIL_SUBJECT,
        text,
      }),
    });
    if (!response.ok) {
      console.error('Resend API error (collector error email):', await response.json().catch(() => ({})));
      return false;
    }
    return true;
  } catch (error) {
    console.error('Collector error email error:', error);
    return false;
  }
}
