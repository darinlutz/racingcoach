// Writes the Terms of Service and Privacy Policy (src/lib/legal.ts) as stand-alone HTML pages, and their versions
// (src/lib/policyVersions.ts), for the collector's installer (collector/installer/RacingCoach.Collector.iss), which
// links to them from its legal agreement page so they can be read offline, and installs them in {app}\legal.
// Run by .github/workflows/collector-release.yml before the installer is built, so the installer always has the
// versions the website shows:
//   node scripts/exportLegal.mjs <output folder>
// writes terms.html, privacy.html and versions.iss (the versions as Inno Setup #defines).
// Node runs the .ts files directly (type stripping); neither imports anything.
import fs from 'node:fs';
import path from 'node:path';
import { privacyPolicy, termsOfService } from '../src/lib/legal.ts';
import { POLICY_VERSIONS } from '../src/lib/policyVersions.ts';

const SITE = 'https://racingcoach.app';
const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node scripts/exportLegal.mjs <output folder>');
  process.exit(1);
}

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The site's links are relative; the exported page isn't on the site
const absolute = (href) => (href.startsWith('/') ? SITE + href : href);

function block(b) {
  if (typeof b === 'string') return `<p>${escape(b)}</p>`;
  if ('strong' in b) return `<p><strong>${escape(b.strong)}</strong></p>`;
  if ('list' in b) return `<ul>${b.list.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`;
  if ('subheading' in b) return `<h3>${escape(b.subheading)}</h3>`;
  return `<p class="contact">${b.contact
    .map(({ label, text, href }) => {
      const value = href ? `<a href="${escape(absolute(href))}">${escape(text)}</a>` : escape(text);
      return label ? `${escape(label)}: ${value}` : value;
    })
    .join('<br>')}</p>`;
}

function page(doc, version, url) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(doc.title)}</title>
<style>
  :root { color-scheme: light dark; --fg: #1b1c1f; --muted: #5d6066; --bg: #fafbfc; --accent: #c81d2a; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f4f5f7; --muted: #92959a; --bg: #0c0d0f; --accent: #e4202f; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 "Segoe UI", Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
  h2 { font-size: 19px; margin: 32px 0 8px; }
  h3 { font-size: 16px; margin: 20px 0 6px; }
  a { color: var(--accent); }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
</style>
</head>
<body>
<main>
<h1>${escape(doc.title)}</h1>
<p class="meta">Effective Date: ${escape(doc.effectiveDate)} · Version ${escape(version)}<br>
The current version is always at <a href="${url}">${url}</a>.</p>
${doc.intro.map(block).join('\n')}
${doc.sections.map((s) => `<h2>${escape(s.heading)}</h2>\n${s.blocks.map(block).join('\n')}`).join('\n')}
</main>
</body>
</html>
`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'terms.html'), page(termsOfService, POLICY_VERSIONS.terms, `${SITE}/terms`));
fs.writeFileSync(path.join(outDir, 'privacy.html'), page(privacyPolicy, POLICY_VERSIONS.privacy, `${SITE}/privacy`));
fs.writeFileSync(
  path.join(outDir, 'versions.iss'),
  `; Written by scripts/exportLegal.mjs from src/lib/policyVersions.ts\n` +
    `#define TermsVersion "${POLICY_VERSIONS.terms}"\n#define PrivacyVersion "${POLICY_VERSIONS.privacy}"\n`
);
console.log(`Terms ${POLICY_VERSIONS.terms}, Privacy ${POLICY_VERSIONS.privacy} -> ${outDir}`);
