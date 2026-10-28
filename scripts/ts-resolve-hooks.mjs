// Node module hooks that let tests import the site's server modules as Next.js resolves them: `@/` is src/, and
// relative imports without an extension find their .ts or .tsx file. Registered by scripts/lap-retention-db.test.mjs;
// run with --experimental-transform-types for the TypeScript Node can't only strip.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = new URL('../src/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  let candidate = null;
  if (specifier.startsWith('@/')) candidate = new URL(specifier.slice(2), src);
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:'))
    candidate = new URL(specifier, context.parentURL);
  if (candidate && !/\.[cm]?[jt]sx?$/.test(candidate.pathname)) {
    const path = fileURLToPath(candidate);
    for (const ending of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(path + ending)) return nextResolve(pathToFileURL(path + ending).href, context);
    }
  }
  if (candidate) return nextResolve(candidate.href, context);
  return nextResolve(specifier, context);
}
