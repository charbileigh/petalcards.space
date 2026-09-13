import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('every frontend ID lookup exists in the page and IDs are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, 'index.html contains duplicate IDs');

  const dynamicIds = [...script.matchAll(/\bid=\\?"([^"\\]+)\\?"/g)].map((match) => match[1]);
  const available = new Set([...ids, ...dynamicIds]);
  const lookups = new Set([...script.matchAll(/byId\('([^']+)'\)/g)].map((match) => match[1]));
  for (const id of lookups) assert.ok(available.has(id), `app.js expects missing #${id}`);
});

test('the app is not configured as a PWA', () => {
  assert.doesNotMatch(html, /rel=["']manifest["']/i);
  assert.doesNotMatch(script, /serviceWorker\.register/);
});
