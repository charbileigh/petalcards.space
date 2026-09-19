export function safeFilename(value) {
  return String(value || 'petalcards-deck').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80) || 'petalcards-deck';
}

export function deckCSV(deck) {
  const cell = (value) => {
    let text = String(value ?? '').replace(/\r\n/g, '\n');
    // Keep spreadsheet software from interpreting card text as a formula.
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [['Front', 'Back', 'Hint', 'Tags'], ...deck.cards.map(({ front, back, hint, tags }) => [front, back, hint, (tags || []).join(', ')])].map((row) => row.map(cell).join(',')).join('\r\n');
}

export function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
