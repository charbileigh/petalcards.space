// Generate a portable interactive preview from the same UI and storage code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const storage = read('public/storage.js').replaceAll("'petalcards-device'", "'petalcards-preview-device'");
const exports = [...storage.matchAll(/export (?:async )?function (\w+)/g)].map((match) => match[1]);
const wrappedStorage = `const library = (() => {\n${storage.replaceAll('export ', '')}\nreturn { ${exports.join(', ')} };\n})();`;
const downloads = read('public/downloads.js').replaceAll('export ', '');
let app = read('public/app.js').replace(/^import .*;\n/gm, '');
// A downloaded preview has no legacy server and must never try to retrieve private data.
app = app.replace(/let copyingPreviousCards = false;[\s\S]*?(?=async function init\(\))/, 'async function copyPreviousCards() {}\n\n');
const script = `${wrappedStorage}\n${downloads}\n${app}\n
 document.getElementById('offline-status').textContent = 'Interactive preview · saves on this device';
 document.addEventListener('click', (event) => {
   if (event.target.closest('[data-action="install-app"]')) document.getElementById('install-dialog').showModal();
 });`;
let html = read('public/index.html')
  .replace(/    <script src=.*?<\/script>\n/g, '')
  .replace(/    <link rel="(?:manifest|apple-touch-icon)".*?\n/g, '')
  .replace('<link rel="stylesheet" href="/styles.css">', `<style>${read('public/styles.css')}</style>`)
  .replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${Buffer.from(read('public/favicon.svg')).toString('base64')}"`)
  .replace('<body>', '<body><p class="preview-note">Interactive preview. Desktop installation is available on the deployed HTTPS app.</p>')
  .replace('</head>', '<style>.preview-note { margin: 0; padding: 12px 20px; background: var(--primary-soft); color: var(--text); text-align: center; font-size: 13px; }</style></head>')
  .replace('</body>', () => `<script type="module">${script.replaceAll('</script', '<\\/script')}</script></body>`);
mkdirSync(root + 'docs', { recursive: true });
writeFileSync(root + 'docs/Petalcards_Preview.html', html);
console.log('Created docs/Petalcards_Preview.html. Open it in a browser to try the app.');
