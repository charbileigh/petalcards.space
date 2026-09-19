// Every write resolves only after IndexedDB commits. No network or session is needed.
export const THEMES = ['pink', 'purple', 'blue', 'green', 'berry', 'grey'];
const ACCENTS = ['rose', 'peach', 'lilac', 'sky', 'mint', 'berry'];
const RATINGS = ['again', 'hard', 'good', 'easy'];
const DAY = 86_400_000;
let databasePromise;

function openDatabase() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('This browser cannot save cards. Open Petalcards in a browser with site storage enabled.'));
    const request = indexedDB.open('petalcards-device', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('decks', { keyPath: 'id' });
      request.result.createObjectStore('meta');
    };
    request.onblocked = () => reject(new Error('Close other Petalcards tabs, then try again.'));
    request.onerror = () => reject(new Error('Device storage is unavailable. Allow site storage and try again.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = null; };
      resolve(db);
    };
  }).catch((error) => { databasePromise = null; throw error; });
  return databasePromise;
}

async function transaction(names, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let value, failure;
    const done = (result) => { value = result; };
    const fail = (error) => { failure = error; tx.abort(); };
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => {
      const cause = failure || tx.error;
      reject(cause?.name === 'QuotaExceededError'
        ? new Error('Device storage is full. Download a backup and free some space before trying again.')
        : failure || new Error('Your change could not be saved. Keep this window open and try again.'));
    };
    tx.onerror = () => {};
    try { work(tx, done, fail); } catch (error) { fail(error); }
  });
}

function text(value, field, max, required = false) {
  if (typeof value !== 'string' && value != null) throw new Error(`${field} must be text.`);
  const result = (value || '').trim();
  if (required && !result) throw new Error(`${field} is required.`);
  if (result.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return result;
}

function number(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
}

function makeCard(values, deckId) {
  return {
    id: crypto.randomUUID(), deckId,
    front: text(values.front, 'Front', 5000, true),
    back: text(values.back, 'Back', 5000, true),
    hint: text(values.hint, 'Hint', 1000),
    createdAt: number(values.createdAt, Date.now()), updatedAt: Date.now(),
    dueAt: values.dueAt == null ? null : number(values.dueAt, null, 8.64e15),
    intervalDays: number(values.intervalDays, 0, 36500),
    ease: Math.max(1.3, number(values.ease, 2.5, 3.2)),
    reviewCount: Math.floor(number(values.reviewCount)),
    correctCount: Math.floor(number(values.correctCount)),
    lastRating: RATINGS.includes(values.lastRating) ? values.lastRating : null,
  };
}

function makeDeck(values) {
  if (!values || typeof values !== 'object') throw new Error('Each deck must contain a title and cards.');
  const id = crypto.randomUUID();
  if (values.cards !== undefined && !Array.isArray(values.cards)) throw new Error('A deck must contain a list of cards.');
  return {
    id, title: text(values.title, 'Deck title', 120, true),
    description: text(values.description, 'Description', 500),
    accent: ACCENTS.includes(values.accent) ? values.accent : 'rose',
    createdAt: number(values.createdAt, Date.now()), updatedAt: Date.now(),
    cards: (values.cards || []).map((card) => makeCard(card, id)),
  };
}

function summary(deck) {
  return {
    ...deck,
    cardCount: deck.cards.length,
    dueCount: deck.cards.filter((card) => !card.dueAt || card.dueAt <= Date.now()).length,
    mastery: deck.cards.length ? Math.round(100 * deck.cards.filter((card) => card.intervalDays >= 21).length / deck.cards.length) : 0,
  };
}

export async function initialize() {
  await transaction(['decks', 'meta'], 'readwrite', (tx) => {
    const meta = tx.objectStore('meta');
    meta.get('initialized').onsuccess = (event) => {
      if (event.target.result) return;
      tx.objectStore('decks').put(makeDeck({
        title: 'Welcome to Petalcards', description: 'A tiny starter deck — edit it, study it, or delete it whenever you like.',
        cards: [
          { front: 'What makes a memory stick?', back: 'Active recall and spaced repetition.', hint: 'Try answering before you flip.' },
          { front: 'Where are my cards saved?', back: 'On this device, even while you are offline.', hint: 'No sign-in is needed.' },
          { front: 'Can I take my cards with me?', back: 'Download a backup in Settings and import it on another device or domain.', hint: 'Your backup includes study progress.' },
        ],
      }));
      meta.put({ name: 'friend' }, 'profile');
      meta.put('pink', 'theme');
      meta.put(true, 'initialized');
    };
  });
  return dashboard();
}

export async function dashboard() {
  return transaction(['decks', 'meta'], 'readonly', (tx, done) => {
    const result = { profile: { name: 'friend' }, theme: 'pink' };
    tx.objectStore('meta').get('profile').onsuccess = (e) => { result.profile = e.target.result || result.profile; };
    tx.objectStore('meta').get('theme').onsuccess = (e) => { result.theme = e.target.result || 'pink'; };
    tx.objectStore('decks').getAll().onsuccess = (e) => {
      result.decks = e.target.result.sort((a, b) => b.updatedAt - a.updatedAt).map((deck) => {
        const { cards, ...overview } = summary(deck);
        return overview;
      });
      const decks = result.decks;
      result.stats = {
        decks: decks.length, cards: decks.reduce((n, d) => n + d.cardCount, 0),
        due: decks.reduce((n, d) => n + d.dueCount, 0),
        mastery: decks.length ? Math.round(decks.reduce((n, d) => n + d.mastery, 0) / decks.length) : 0,
      };
    };
    done(result);
  });
}

export async function getDeck(id) {
  return transaction(['decks'], 'readonly', (tx, done, fail) => {
    tx.objectStore('decks').get(id).onsuccess = (e) => {
      if (!e.target.result) return fail(new Error('This deck no longer exists. Return to All decks.'));
      done({ deck: summary(e.target.result) });
    };
  });
}

export async function createDeck(values) {
  const deck = makeDeck(values);
  return transaction(['decks'], 'readwrite', (tx, done) => {
    tx.objectStore('decks').add(deck);
    done({ deck: summary(deck) });
  });
}

async function editDeck(id, edit) {
  return transaction(['decks'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('decks');
    store.get(id).onsuccess = (e) => {
      try {
        const deck = e.target.result;
        if (!deck) throw new Error('This deck no longer exists. Return to All decks.');
        const result = edit(deck);
        deck.updatedAt = Date.now();
        store.put(deck);
        done(result || { deck: summary(deck) });
      } catch (error) { fail(error); }
    };
  });
}

export function updateDeck(id, values) {
  return editDeck(id, (deck) => {
    deck.title = text(values.title, 'Deck title', 120, true);
    deck.description = text(values.description, 'Description', 500);
    deck.accent = ACCENTS.includes(values.accent) ? values.accent : deck.accent;
  });
}

export function deleteDeck(id) {
  return transaction(['decks'], 'readwrite', (tx) => tx.objectStore('decks').delete(id));
}

export function createCard(deckId, values) {
  const card = makeCard(values, deckId);
  return editDeck(deckId, (deck) => { deck.cards.push(card); return { card }; });
}

function existingCard(deck, cardId) {
  const card = deck.cards.find((item) => item.id === cardId);
  if (!card) throw new Error('This card no longer exists. Reopen the deck.');
  return card;
}

export function updateCard(deckId, cardId, values) {
  return editDeck(deckId, (deck) => {
    const card = existingCard(deck, cardId);
    card.front = text(values.front, 'Front', 5000, true);
    card.back = text(values.back, 'Back', 5000, true);
    card.hint = text(values.hint, 'Hint', 1000);
    card.updatedAt = Date.now();
    return { card };
  });
}

export function deleteCard(deckId, cardId) {
  return editDeck(deckId, (deck) => {
    existingCard(deck, cardId);
    deck.cards = deck.cards.filter((card) => card.id !== cardId);
  });
}

export function nextReview(card, rating) {
  let interval = card.intervalDays || 0;
  let ease = card.ease || 2.5;
  if (rating === 'again') { interval = 10 / 1440; ease = Math.max(1.3, ease - 0.2); }
  else if (rating === 'hard') { interval = interval < 1 ? 1 : interval * 1.2; ease = Math.max(1.3, ease - 0.15); }
  else if (rating === 'good') interval = interval < 1 ? 1 : interval * ease;
  else if (rating === 'easy') { interval = interval < 1 ? 4 : Math.max(4, interval * ease * 1.3); ease = Math.min(3.2, ease + 0.15); }
  else throw new Error('Choose a valid study rating.');
  return { intervalDays: Math.min(interval, 36500), ease };
}

export function reviewCard(deckId, cardId, rating) {
  return editDeck(deckId, (deck) => {
    const card = existingCard(deck, cardId);
    Object.assign(card, nextReview(card, rating));
    card.dueAt = Date.now() + Math.round(card.intervalDays * DAY);
    card.reviewCount += 1;
    if (rating === 'good' || rating === 'easy') card.correctCount += 1;
    card.lastRating = rating;
    card.updatedAt = Date.now();
    return { card };
  });
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) throw new Error('Choose a valid theme.');
  return transaction(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(theme, 'theme'));
}

export function setProfile(name) {
  const profile = { name: text(name, 'Name', 60) || 'friend' };
  return transaction(['meta'], 'readwrite', (tx, done) => {
    tx.objectStore('meta').put(profile, 'profile'); done({ profile });
  });
}

export function backup() {
  return transaction(['meta', 'decks'], 'readonly', (tx, done) => {
    const result = { format: 'petalcards-backup', version: 1, exportedAt: new Date().toISOString() };
    tx.objectStore('meta').get('profile').onsuccess = (e) => { result.profile = e.target.result; };
    tx.objectStore('meta').get('theme').onsuccess = (e) => { result.theme = e.target.result; };
    tx.objectStore('decks').getAll().onsuccess = (e) => { result.decks = e.target.result; };
    done(result);
  });
}

export function importLibrary(payload, { sourceId } = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Choose a Petalcards JSON backup or deck export.');
  if (payload.version !== undefined && payload.version !== 1) throw new Error('This backup version is not supported.');
  const raw = payload.decks || (payload.deck ? [payload.deck] : null);
  if (!Array.isArray(raw) || raw.length > 1000) throw new Error('Choose a backup with no more than 1,000 decks.');
  if (raw.reduce((n, deck) => n + (Array.isArray(deck?.cards) ? deck.cards.length : 0), 0) > 50000) throw new Error('Import up to 50,000 cards at a time.');
  // Validate the complete import before a single record is written. New IDs avoid overwriting local work.
  const decks = raw.map(makeDeck);
  return transaction(['decks', 'meta'], 'readwrite', (tx, done) => {
    const meta = tx.objectStore('meta');
    const write = () => {
      for (const deck of decks) tx.objectStore('decks').add(deck);
      if (sourceId) meta.put(true, `imported:${sourceId}`);
      done(decks.length);
    };
    if (sourceId) meta.get(`imported:${sourceId}`).onsuccess = (e) => e.target.result ? done(0) : write();
    else write();
  });
}
