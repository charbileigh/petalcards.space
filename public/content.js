export function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

// Only three inline formats are supported. All original HTML remains escaped.
export function richText(value) {
  return escapeHtml(value).replace(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g, (part) => {
    if (part.startsWith('**')) return `<strong>${part.slice(2, -2)}</strong>`;
    if (part.startsWith('`')) return `<code>${part.slice(1, -1)}</code>`;
    return `<em>${part.slice(1, -1)}</em>`;
  }).replaceAll('\n', '<br>');
}

export function parseCards(input, delimiter = 'auto') {
  const source = String(input).replace(/^\uFEFF/, '');
  if (!source.trim()) throw new Error('Paste your questions and answers or choose a CSV file.');
  if (delimiter === 'auto') {
    let inQuote = false, tabs = 0, commas = 0, semicolons = 0;
    for (const char of source) {
      if (char === '"') inQuote = !inQuote;
      if (!inQuote && char === '\n') break;
      if (!inQuote) { if (char === '\t') tabs++; if (char === ',') commas++; if (char === ';') semicolons++; }
    }
    delimiter = tabs ? '\t' : semicolons > commas ? ';' : ',';
  }
  if (!['\t', ',', ';'].includes(delimiter)) throw new Error('Choose a valid separator.');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const field = () => { row.push(cell); cell = ''; closed = false; };
  for (let i = 0; i <= source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === undefined) throw new Error('A quoted field is missing its closing quote.');
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === delimiter) field();
    else if (char === '\n' || char === '\r' || char === undefined) {
      field(); if (row.some((v) => v.trim())) rows.push(row); row = [];
      if (char === '\r' && source[i + 1] === '\n') i++;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed && char.trim()) throw new Error('Unexpected text after a closing quote. Check your CSV separators.');
      if (!closed) cell += char;
    }
  }
  if (!rows.length) throw new Error('No cards were found.');
  const header = rows[0].map((v) => v.trim().toLowerCase());
  const front = header.findIndex((v) => ['front', 'question'].includes(v));
  const back = header.findIndex((v) => ['back', 'answer'].includes(v));
  const hasHeader = front >= 0 && back >= 0;
  const columns = hasHeader ? { front, back, hint: header.indexOf('hint'), tags: header.indexOf('tags') } : { front: 0, back: 1, hint: 2, tags: 3 };
  const data = hasHeader ? rows.slice(1) : rows;
  if (!data.length || data.length > 5000) throw new Error('Import between 1 and 5,000 cards at a time.');
  return data.map((values, i) => {
    if (!hasHeader && values.length > 4) throw new Error(`Row ${i + 1} has too many columns. Choose the correct separator or quote text containing commas.`);
    const result = Object.fromEntries(Object.entries(columns).map(([key, index]) => [key, values[index]?.trim() || '']));
    if (!result.front || !result.back) throw new Error(`Row ${i + (hasHeader ? 2 : 1)} needs both a question and an answer.`);
    if (result.front.length > 5000 || result.back.length > 5000 || result.hint.length > 1000) throw new Error(`Row ${i + 1} contains too much text.`);
    return result;
  });
}

export async function readCardImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image under 8 MB.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This image could not be opened. Try a different image.'); }
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('Choose an image smaller than 40 megapixels.');
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const src = canvas.toDataURL('image/webp', 0.84);
    if (src.length > 2_000_000) throw new Error('This image is too large to save. Try a smaller image.');
    return { src, alt: '' };
  } finally { bitmap.close(); }
}
