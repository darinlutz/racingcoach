// The look of the emails the site sends to its users (the email address confirmation, the password reset): the
// RacingCoach.app logo, the pit lane banner, a card with the message and a red button, and a footer, in the site's
// dark theme (collector/installer/branding/colors.json). No imports, so tests render it directly.
//
// Built for email apps rather than browsers: tables for layout, every style inline, no web fonts, CSS or SVG (Gmail
// and Outlook drop them), images as absolute URLs on the site (public/assets/email/, rendered by
// collector/installer/branding/generate.mjs) with alt text and fixed sizes, so a message with images blocked still
// reads well, and the link written out under the button for email apps that strip buttons.

const COLORS = {
  page: '#0c0d0f',
  card: '#151618',
  border: '#2f3033',
  text: '#f4f5f7',
  muted: '#92959a',
  primary: '#e4202f',
};

const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export type EmailContent = {
  siteUrl: string;
  // The language of the text, for <html lang>
  language: string;
  subject: string;
  heading: string;
  // Paragraphs before the button
  intro: string[];
  button: { label: string; url: string };
  // Under the button: how long the link lasts
  note?: string;
  // "If the button doesn't work, copy this link into your browser:"
  linkFallback: string;
  // Small print at the bottom of the card, e.g. what to do when it wasn't you
  footnote: string;
};

export function renderEmail(email: EmailContent): { html: string; text: string } {
  const site = email.siteUrl.replace(/\/+$/, '');
  const host = site.replace(/^https?:\/\//, '');
  const url = escapeHtml(email.button.url);
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${COLORS.text};">${escapeHtml(text)}</p>`;

  const html = `<!doctype html>
<html lang="${escapeHtml(email.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(email.intro[0] ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td align="left" style="padding:0 0 20px;">
            <a href="${escapeHtml(site)}" style="text-decoration:none;">
              <img src="${escapeHtml(site)}/assets/email/racingcoach-logo.png" width="280" height="48" alt="RACINGCOACH.APP"
                style="display:block;border:0;outline:none;width:280px;height:48px;color:${COLORS.text};font-family:${FONT};font-size:22px;font-weight:bold;">
            </a>
          </td>
        </tr>
        <tr>
          <td style="background-color:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:0;line-height:0;">
                  <img src="${escapeHtml(site)}/assets/email/pitlane-banner.jpg" width="600" alt=""
                    style="display:block;border:0;width:100%;max-width:600px;height:auto;border-radius:12px 12px 0 0;">
                </td>
              </tr>
              <tr><td style="height:4px;background-color:${COLORS.primary};font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:32px 32px 8px;">
                  <h1 style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:${COLORS.text};">${escapeHtml(email.heading)}</h1>
                  ${email.intro.map(paragraph).join('\n                  ')}
                </td>
              </tr>
              <tr>
                <td align="left" style="padding:8px 32px 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="${COLORS.primary}" style="border-radius:8px;">
                        <a href="${url}" target="_blank"
                          style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(email.button.label)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 32px 28px;">
                  ${email.note ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:21px;color:${COLORS.muted};">${escapeHtml(email.note)}</p>` : ''}
                  <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:19px;color:${COLORS.muted};">${escapeHtml(email.linkFallback)}</p>
                  <p style="margin:0;font-family:${FONT};font-size:13px;line-height:19px;word-break:break-all;"><a href="${url}" style="color:${COLORS.primary};text-decoration:underline;">${url}</a></p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 32px 28px;border-top:1px solid ${COLORS.border};">
                  <p style="margin:0;font-family:${FONT};font-size:13px;line-height:19px;color:${COLORS.muted};">${escapeHtml(email.footnote)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 16px 0;">
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">
              <a href="${escapeHtml(site)}" style="color:${COLORS.muted};text-decoration:underline;">${escapeHtml(host)}</a> &middot; Clarivex LLC
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    email.heading,
    '',
    ...email.intro.flatMap((p) => [p, '']),
    `${email.button.label}: ${email.button.url}`,
    '',
    ...(email.note ? [email.note, ''] : []),
    email.footnote,
    '',
    `-- \nRacingCoach.app · ${host}`,
  ].join('\n');

  return { html, text };
}
