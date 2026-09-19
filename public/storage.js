// Every write resolves only after IndexedDB commits. No network or session is needed.
export const THEMES = ['pink', 'purple', 'blue', 'green', 'berry', 'grey'];
const ACCENTS = ['rose', 'peach', 'lilac', 'sky', 'mint', 'berry'];
const RATINGS = ['again', 'hard', 'good', 'easy'];
const DAY = 86_400_000;
let databasePromise;

function openDatabase() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('This browser cannot save cards. Open Petalcards in a browser with site storage enabled.'));
    const request = indexedDB.open('petalcards-device', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash', { keyPath: 'id' });
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

async function transaction(names, mode, work, trackChanges = true) {
  const db = await openDatabase();
  const changesCards = trackChanges && mode === 'readwrite' && names.includes('decks');
  names = [...new Set([...names, ...(changesCards ? ['meta'] : [])])];
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
    try {
      work(tx, done, fail);
      if (changesCards) {
        const meta = tx.objectStore('meta');
        meta.get('revision').onsuccess = (e) => meta.put((e.target.result || 0) + 1, 'revision');
      }
    } catch (error) { fail(error); }
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

function tags(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const result = [...new Set(items.map((tag) => text(tag, 'Tag', 30)).filter(Boolean))];
  if (result.length > 20) throw new Error('Use up to 20 tags.');
  return result;
}

function cardImage(value) {
  if (!value) return null;
  if (typeof value.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.src) || value.src.length > 2_000_000) {
    throw new Error('Use a PNG, JPEG or WebP image smaller than 1.5 MB.');
  }
  return { src: value.src, alt: text(value.alt, 'Image description', 300) };
}

function makeCard(values, deckId) {
  return {
    id: crypto.randomUUID(), deckId,
    front: text(values.front, 'Front', 5000, true),
    back: text(values.back, 'Back', 5000, true),
    hint: text(values.hint, 'Hint', 1000),
    tags: tags(values.tags), favorite: values.favorite === true,
    frontImage: cardImage(values.frontImage), backImage: cardImage(values.backImage),
    lapses: Math.floor(number(values.lapses)),
    recentReviews: (Array.isArray(values.recentReviews) ? values.recentReviews : []).filter((r) => r && number(r.at) > Date.now() - 90 * DAY && RATINGS.includes(r.rating)).slice(-5000).map(({ at, rating }) => ({ at, rating })),
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
    folder: text(values.folder, 'Folder', 60), tags: tags(values.tags), favorite: values.favorite === true,
    accent: ACCENTS.includes(values.accent) ? values.accent : 'rose',
    createdAt: number(values.createdAt, Date.now()), updatedAt: Date.now(),
    cards: (values.cards || []).map((card) => makeCard(card, id)),
  };
}

function summary(deck) {
  return {
    ...deck, folder: deck.folder || '', tags: deck.tags || [], favorite: deck.favorite || false,
    searchText: [deck.title, deck.description, deck.folder, ...(deck.tags || []), ...deck.cards.flatMap((c) => [c.front, c.back, c.hint, ...(c.tags || [])])].join(' ').toLowerCase(),
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
      meta.put(1, 'revision');
    };
  }, false);
  return dashboard();
}

export async function dashboard() {
  return transaction(['decks', 'meta'], 'readonly', (tx, done) => {
    const result = { profile: { name: 'friend' }, theme: 'pink', ui: {}, backup: {} };
    for (const key of ['revision', 'backupRevision', 'backupAt', 'backupSnooze']) {
      tx.objectStore('meta').get(key).onsuccess = (e) => { result.backup[key] = e.target.result || 0; };
    }
    tx.objectStore('meta').get('ui').onsuccess = (e) => { result.ui = e.target.result || {}; };
    tx.objectStore('meta').get('session').onsuccess = (e) => { result.session = e.target.result || null; };
    tx.objectStore('meta').get('profile').onsuccess = (e) => { result.profile = e.target.result || result.profile; };
    tx.objectStore('meta').get('theme').onsuccess = (e) => { result.theme = e.target.result || 'pink'; };
    tx.objectStore('decks').getAll().onsuccess = (e) => {
      result.progress = progressStats(e.target.result);
      result.decks = e.target.result.sort((a, b) => b.updatedAt - a.updatedAt).map((deck) => {
        const { cards, ...overview } = summary(deck);
        return overview;
      });
      const decks = result.decks;
      result.stats = {
        decks: decks.length, cards: decks.reduce((n, d) => n + d.cardCount, 0),
        due: decks.reduce((n, d) => n + d.dueCount, 0),
        mastery: result.progress.mastery,
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
    deck.folder = text(values.folder, 'Folder', 60);
    deck.tags = tags(values.tags);
  });
}

export function deleteDeck(id) {
  return transaction(['decks', 'trash'], 'readwrite', (tx, done, fail) => {
    tx.objectStore('decks').get(id).onsuccess = (e) => {
      const deck = e.target.result;
      if (!deck) return fail(new Error('This deck no longer exists.'));
      const item = { id: crypto.randomUUID(), kind: 'deck', deck, deletedAt: Date.now() };
      tx.objectStore('trash').put(item);
      tx.objectStore('decks').delete(id);
      done(item);
    };
  });
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
    card.tags = tags(values.tags);
    card.frontImage = cardImage(values.frontImage);
    card.backImage = cardImage(values.backImage);
    card.updatedAt = Date.now();
    return { card };
  });
}

export function deleteCard(deckId, cardId) {
  return transaction(['decks', 'trash'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('decks');
    store.get(deckId).onsuccess = (e) => {
      try {
        const deck = e.target.result;
        if (!deck) throw new Error('This deck no longer exists.');
        const card = existingCard(deck, cardId);
        const item = { id: crypto.randomUUID(), kind: 'card', card, deck: { ...deck, cards: [] }, position: deck.cards.indexOf(card), deletedAt: Date.now() };
        tx.objectStore('trash').put(item);
        deck.cards = deck.cards.filter((c) => c.id !== cardId);
        deck.updatedAt = Date.now(); store.put(deck); done(item);
      } catch (error) { fail(error); }
    };
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

function applyRating(card, rating) {
  Object.assign(card, nextReview(card, rating));
  card.dueAt = Date.now() + Math.round(card.intervalDays * DAY);
  card.reviewCount += 1;
  if (rating === 'good' || rating === 'easy') card.correctCount += 1;
  if (rating === 'again') card.lapses = (card.lapses || 0) + 1;
  card.lastRating = rating;
  card.updatedAt = Date.now();
  card.recentReviews = [...(card.recentReviews || []).filter((r) => r.at > Date.now() - 90 * DAY), { at: Date.now(), rating }].slice(-5000);
}

export function reviewCard(deckId, cardId, rating, sessionId = null) {
  return transaction(['decks', 'meta'], 'readwrite', (tx, done, fail) => {
    const meta = tx.objectStore('meta');
    const store = tx.objectStore('decks');
    meta.get('session').onsuccess = (event) => {
      const session = event.target.result;
      if (sessionId && (!session || session.id !== sessionId)) return fail(new Error('This session changed in another tab. Reopen it to continue.'));
      store.get(deckId).onsuccess = (e) => {
        try {
          const deck = e.target.result;
          if (!deck) throw new Error('This deck no longer exists.');
          const card = existingCard(deck, cardId);
          if (!sessionId || !session.ratings[cardId]) {
            applyRating(card, rating); store.put(deck);
            if (sessionId) {
              session.ratings[cardId] = rating;
              session.index = Math.min(session.index + 1, session.cardIds.length);
              session.flipped = false; session.updatedAt = Date.now();
              meta.put(session, 'session');
            }
          }
          done({ card, session: sessionId ? session : null });
        } catch (error) { fail(error); }
      };
    };
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
    const result = { format: 'petalcards-backup', version: 2, exportedAt: new Date().toISOString() };
    tx.objectStore('meta').get('profile').onsuccess = (e) => { result.profile = e.target.result; };
    tx.objectStore('meta').get('revision').onsuccess = (e) => { result.revision = e.target.result || 0; };
    tx.objectStore('meta').get('theme').onsuccess = (e) => { result.theme = e.target.result; };
    tx.objectStore('decks').getAll().onsuccess = (e) => { result.decks = e.target.result; };
    done(result);
  });
}

export function importLibrary(payload, { sourceId } = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Choose a Petalcards JSON backup or deck export.');
  if (payload.version !== undefined && ![1, 2].includes(payload.version)) throw new Error('This backup version is not supported.');
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
      if (decks.length) meta.get('revision').onsuccess = (e) => meta.put((e.target.result || 0) + 1, 'revision');
      done(decks.length);
    };
    if (sourceId) meta.get(`imported:${sourceId}`).onsuccess = (e) => e.target.result ? done(0) : write();
    else write();
  }, false);
}

export function isDifficult(card) {
  return ['again', 'hard'].includes(card.lastRating) || (card.reviewCount >= 3 && card.correctCount / card.reviewCount < 0.7);
}

function progressStats(decks) {
  const cards = decks.flatMap((deck) => deck.cards.map((card) => ({ ...card, deckTitle: deck.title, deckId: deck.id })));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const from = new Date(today); from.setDate(from.getDate() + i);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    return { date: from.toISOString(), count: cards.filter((c) => i === 0 ? (!c.dueAt || c.dueAt < to.getTime()) : c.dueAt >= from.getTime() && c.dueAt < to.getTime()).length };
  });
  return {
    mastery: cards.length ? Math.round(100 * cards.filter((c) => c.intervalDays >= 21).length / cards.length) : 0,
    todayCards: cards.filter((c) => (c.recentReviews || []).some((r) => r.at >= today.getTime())).length,
    todayReviews: cards.reduce((n, c) => n + (c.recentReviews || []).filter((r) => r.at >= today.getTime()).length, 0),
    upcoming,
    difficult: cards.filter(isDifficult).sort((a, b) => (b.lapses || 0) - (a.lapses || 0)).slice(0, 5).map(({ id, deckId, deckTitle, front, lapses }) => ({ id, deckId, deckTitle, front, lapses: lapses || 0 })),
  };
}

export function markBackup(revision) {
  return transaction(['meta'], 'readwrite', (tx) => {
    tx.objectStore('meta').put(Date.now(), 'backupAt');
    tx.objectStore('meta').put(revision, 'backupRevision');
  });
}

export function snoozeBackup() {
  return transaction(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(Date.now() + DAY, 'backupSnooze'));
}

export function setUI(values) {
  const ui = { cardSize: ['normal', 'large', 'larger'].includes(values.cardSize) ? values.cardSize : 'normal', focus: values.focus === true };
  return transaction(['meta'], 'readwrite', (tx, done) => { tx.objectStore('meta').put(ui, 'ui'); done(ui); });
}

export function toggleFavorite(deckId, cardId = null) {
  return editDeck(deckId, (deck) => {
    const item = cardId ? existingCard(deck, cardId) : deck;
    item.favorite = !item.favorite;
  });
}

export function addCards(deckId, values) {
  if (!Array.isArray(values) || !values.length || values.length > 5000) throw new Error('Add between 1 and 5,000 cards at a time.');
  const cards = values.map((v) => makeCard(v, deckId));
  return editDeck(deckId, (deck) => { deck.cards.push(...cards); return { count: cards.length }; });
}

export function transferCard(sourceId, cardId, targetId, copy = false) {
  return transaction(['decks'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('decks');
    store.get(sourceId).onsuccess = (e) => {
      const source = e.target.result;
      store.get(targetId).onsuccess = (event) => {
        try {
          if (!source || !event.target.result) throw new Error('Choose an existing destination deck.');
          if (!copy && sourceId === targetId) throw new Error('Choose another deck to move this card.');
          const target = sourceId === targetId ? source : event.target.result;
          const original = existingCard(source, cardId);
          const card = copy ? makeCard({ ...original, reviewCount: 0, correctCount: 0, intervalDays: 0, dueAt: null, lastRating: null, lapses: 0, recentReviews: [], ease: 2.5 }, targetId) : { ...original, deckId: targetId };
          if (!copy) source.cards = source.cards.filter((c) => c.id !== cardId);
          target.cards.push(card); target.updatedAt = Date.now();
          if (sourceId !== targetId && !copy) { source.updatedAt = Date.now(); store.put(source); }
          store.put(target); done({ card });
        } catch (error) { fail(error); }
      };
    };
  });
}

export function getTrash() {
  return transaction(['trash'], 'readonly', (tx, done) => {
    tx.objectStore('trash').getAll().onsuccess = (e) => done(e.target.result.sort((a, b) => b.deletedAt - a.deletedAt));
  });
}

export function restoreTrash(id) {
  return transaction(['decks', 'trash'], 'readwrite', (tx, done, fail) => {
    const trash = tx.objectStore('trash'), decks = tx.objectStore('decks');
    trash.get(id).onsuccess = (e) => {
      const item = e.target.result;
      if (!item) return fail(new Error('This item has already been restored or removed.'));
      decks.get(item.deck.id).onsuccess = (event) => {
        const current = event.target.result;
        const deck = current || { ...item.deck, cards: [] };
        const restored = item.kind === 'deck' ? item.deck.cards : [item.card];
        const ids = new Set(deck.cards.map((c) => c.id));
        const missing = restored.filter((c) => !ids.has(c.id));
        if (item.kind === 'card') deck.cards.splice(Math.min(item.position, deck.cards.length), 0, ...missing);
        else deck.cards.push(...missing);
        deck.updatedAt = Date.now(); decks.put(deck); trash.delete(id); done({ deck: summary(deck) });
      };
    };
  });
}

export function emptyTrash() {
  return transaction(['trash'], 'readwrite', (tx) => tx.objectStore('trash').clear());
}

export function getSession() {
  return transaction(['meta'], 'readonly', (tx, done) => {
    tx.objectStore('meta').get('session').onsuccess = (e) => done(e.target.result || null);
  });
}

export async function beginSession(deckId, options = {}) {
  const { deck } = await getDeck(deckId);
  const mode = ['all', 'due', 'difficult', 'favorites'].includes(options.mode) ? options.mode : 'due';
  let cards = deck.cards.filter((c) => mode === 'all' || (mode === 'due' && (!c.dueAt || c.dueAt <= Date.now())) || (mode === 'difficult' && isDifficult(c)) || (mode === 'favorites' && c.favorite));
  if (!cards.length) throw new Error('No cards match this study option. Choose another group.');
  if (options.shuffle) {
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  }
  const limit = Number(options.limit) || cards.length;
  cards = cards.slice(0, Math.max(1, Math.min(limit, cards.length)));
  const session = { id: crypto.randomUUID(), deckId, deckTitle: deck.title, cardIds: cards.map((c) => c.id), index: 0, flipped: false, ratings: {}, reverse: options.reverse === true, mode, updatedAt: Date.now() };
  await transaction(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(session, 'session'));
  return session;
}

export function saveSession(session) {
  return transaction(['meta'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('meta');
    store.get('session').onsuccess = (e) => {
      const current = e.target.result;
      if (!current || current.id !== session.id) return fail(new Error('This session changed in another tab. Reopen it to continue.'));
      const result = { ...session, ratings: { ...session.ratings, ...current.ratings }, updatedAt: Date.now() };
      delete result.saving;
      store.put(result, 'session'); done(result);
    };
  });
}
