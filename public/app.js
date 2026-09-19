import * as library from './storage.js';
import { downloadFile, deckCSV, safeFilename } from './downloads.js';
const THEMES = ['pink', 'purple', 'blue', 'green', 'berry', 'grey'];
const state = {
  profile: null,
  theme: 'pink',
  decks: [],
  stats: { decks: 0, cards: 0, due: 0, mastery: 0 },
  currentDeck: null,
  study: null,
  search: '',
  confirmAction: null,
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, kind = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${kind === 'error' ? 'error' : ''}`;
  const text = document.createElement('span');
  text.textContent = message;
  item.append(text);
  byId('toast-region').append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function setBusy(form, busy) {
  for (const control of form.elements) control.disabled = busy;
  form.setAttribute('aria-busy', String(busy));
}

function initials(name) {
  return String(name || 'P').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function setTheme(theme, { save = true } = {}) {
  const selected = THEMES.includes(theme) ? theme : 'pink';
  if (save) {
    library.setTheme(selected).then(() => setTheme(selected, { save: false })).catch((error) => toast(error.message, 'error'));
    return;
  }
  state.theme = selected;
  document.documentElement.dataset.theme = selected;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected === 'pink' ? '#fffafd' : '#16121f');
  $$('[data-theme-choice]').forEach((button) => button.classList.toggle('active', button.dataset.themeChoice === selected));
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function showView(id) {
  $$('.view', byId('app-shell')).forEach((view) => view.classList.toggle('hidden', view.id !== id));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function updateHeader() {
  if (!state.profile) return;
  byId('user-avatar').textContent = initials(state.profile.name);
  byId('user-name-short').textContent = state.profile.name.split(/\s+/)[0];
  byId('greeting-name').textContent = state.profile.name.split(/\s+/)[0];
  byId('time-greeting').textContent = timeGreeting();
}

function showApp(payload) {
  state.profile = payload.profile;
  state.decks = payload.decks || [];
  state.stats = payload.stats || { decks: 0, cards: 0, due: 0, mastery: 0 };
  byId('boot-screen').classList.add('hidden');
  byId('app-shell').classList.remove('hidden');
  setTheme(payload.theme || 'pink', { save: false });
  updateHeader();
  renderDashboard();
  showView('dashboard-view');
}

function plural(count, singular, pluralText = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function renderDashboard() {
  updateHeader();
  byId('stat-decks').textContent = state.stats.decks;
  byId('stat-cards').textContent = state.stats.cards;
  byId('stat-due').textContent = state.stats.due;
  byId('stat-mastery').textContent = `${state.stats.mastery}%`;
  byId('deck-count-label').textContent = plural(state.decks.length, 'deck');

  const query = state.search.trim().toLowerCase();
  const visible = state.decks.filter((deck) => `${deck.title} ${deck.description}`.toLowerCase().includes(query));
  const grid = byId('deck-grid');
  grid.innerHTML = visible.map((deck) => `
    <article class="deck-card accent-${deck.accent}" data-action="open-deck" data-deck-id="${deck.id}" tabindex="0" aria-label="Open ${escapeHtml(deck.title)}">
      <div class="deck-cover"><span class="deck-bloom">✿</span></div>
      <div class="deck-body">
        <h3>${escapeHtml(deck.title)}</h3>
        <p>${escapeHtml(deck.description || 'A collection ready to grow.')}</p>
        <div class="deck-meta"><span>${plural(deck.cardCount, 'card')}</span><span>${deck.dueCount ? `${deck.dueCount} due` : 'All caught up'}</span></div>
        <div class="deck-progress" title="${deck.mastery}% mastery"><progress max="100" value="${Math.max(2, deck.mastery)}" aria-label="${deck.mastery}% mastery"></progress></div>
      </div>
      <button class="deck-study" type="button" data-action="study-deck" data-deck-id="${deck.id}" aria-label="Study ${escapeHtml(deck.title)}" title="Study this deck">▶</button>
    </article>
  `).join('');
  grid.classList.toggle('hidden', visible.length === 0);
  byId('empty-decks').classList.toggle('hidden', state.decks.length !== 0 || Boolean(query));
  byId('no-search-results').classList.toggle('hidden', !query || visible.length !== 0);
}

async function refreshDecks() {
  const payload = await library.dashboard();
  state.decks = payload.decks;
  state.stats = payload.stats;
  renderDashboard();
}

function formatDue(card) {
  if (!card.dueAt) return '<span class="due-dot"></span>New';
  const delta = card.dueAt - Date.now();
  if (delta <= 0) return '<span class="due-dot"></span>Due now';
  const hours = Math.ceil(delta / 3_600_000);
  if (hours < 24) return `In ${hours}h`;
  return `In ${Math.ceil(hours / 24)}d`;
}

function renderDeck() {
  const deck = state.currentDeck;
  if (!deck) return;
  const hero = byId('deck-hero');
  hero.className = `deck-hero accent-${deck.accent}`;
  hero.innerHTML = `
    <div class="deck-hero-copy">
      <span class="section-kicker">${escapeHtml(deck.accent.toUpperCase())} COLLECTION</span>
      <h1>${escapeHtml(deck.title)}</h1>
      <p>${escapeHtml(deck.description || 'No description yet.')}</p>
      <div class="hero-stats"><span>${plural(deck.cardCount, 'card')}</span><span>${deck.dueCount} due now</span><span>${deck.mastery}% mastery</span></div>
    </div>
    <div class="deck-hero-actions">
      <button class="button button-primary" type="button" data-action="study-deck" data-deck-id="${deck.id}" ${deck.cardCount ? '' : 'disabled'}>▶ Study now</button>
      <details class="more-menu">
        <summary class="icon-button" aria-label="Deck options">•••</summary>
        <div class="more-popover">
          <button type="button" data-action="edit-deck">Edit deck</button>
          <button type="button" data-action="export-deck" data-format="csv">Download CSV</button>
          <button type="button" data-action="export-deck" data-format="json">Download JSON</button>
          <button class="danger" type="button" data-action="delete-deck">Delete deck</button>
        </div>
      </details>
    </div>`;

  const list = byId('card-list');
  list.innerHTML = deck.cards.map((card, index) => `
    <article class="library-card" data-card-id="${card.id}">
      <div class="card-copy"><small>FRONT · ${index + 1}</small><p>${escapeHtml(card.front)}</p></div>
      <span class="divider" aria-hidden="true"></span>
      <div class="card-copy"><small>BACK · ${formatDue(card)}</small><p>${escapeHtml(card.back)}</p></div>
      <div class="card-tools">
        <button class="tiny-button" type="button" data-action="edit-card" data-card-id="${card.id}" aria-label="Edit card" title="Edit">✎</button>
        <button class="tiny-button danger" type="button" data-action="delete-card" data-card-id="${card.id}" aria-label="Delete card" title="Delete">×</button>
      </div>
    </article>`).join('');
  list.classList.toggle('hidden', deck.cards.length === 0);
  byId('empty-cards').classList.toggle('hidden', deck.cards.length !== 0);
}

async function openDeck(deckId) {
  try {
    const payload = await library.getDeck(deckId);
    state.currentDeck = payload.deck;
    renderDeck();
    showView('deck-view');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openDeckDialog(mode = 'create') {
  const editing = mode === 'edit';
  const deck = editing ? state.currentDeck : null;
  byId('deck-dialog-title').textContent = editing ? 'Edit this deck' : 'Create a new deck';
  byId('deck-submit').textContent = editing ? 'Save changes' : 'Create deck';
  byId('deck-id').value = deck?.id || '';
  byId('deck-title').value = deck?.title || '';
  byId('deck-description').value = deck?.description || '';
  const accent = deck?.accent || 'rose';
  $$('#deck-form input[name="accent"]').forEach((input) => { input.checked = input.value === accent; });
  byId('deck-dialog').showModal();
  byId('deck-title').focus();
}

function openCardDialog(card = null) {
  byId('card-dialog-title').textContent = card ? 'Edit this card' : 'Add a card';
  byId('card-submit').textContent = card ? 'Save changes' : 'Add card';
  byId('card-id').value = card?.id || '';
  byId('card-front').value = card?.front || '';
  byId('card-back').value = card?.back || '';
  byId('card-hint').value = card?.hint || '';
  byId('card-dialog').showModal();
  byId('card-front').focus();
}

function openSettings() {
  byId('profile-name').value = state.profile.name === 'friend' ? '' : state.profile.name;
  byId('settings-dialog').showModal();
}

function openConfirm({ title, message, confirmText = 'Delete', action }) {
  byId('confirm-title').textContent = title;
  byId('confirm-message').textContent = message;
  byId('confirm-button').textContent = confirmText;
  state.confirmAction = action;
  byId('confirm-dialog').showModal();
}

function dueCards(cards) {
  const now = Date.now();
  return cards.filter((card) => !card.dueAt || card.dueAt <= now);
}

async function startStudy(deckId) {
  try {
    if (!state.currentDeck || state.currentDeck.id !== deckId) {
      const payload = await library.getDeck(deckId);
      state.currentDeck = payload.deck;
    }
    if (!state.currentDeck.cards.length) {
      toast('Add at least one card before studying.', 'error');
      renderDeck();
      showView('deck-view');
      return;
    }
    const ready = dueCards(state.currentDeck.cards);
    state.study = {
      deckId,
      cards: [...(ready.length ? ready : state.currentDeck.cards)],
      index: 0,
      flipped: false,
      hintVisible: false,
      reviewed: 0,
    };
    byId('study-deck-name').textContent = state.currentDeck.title;
    showView('study-view');
    renderStudyCard();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function ratingIntervals(card) {
  return Object.fromEntries(['again', 'hard', 'good', 'easy'].map((rating) => {
    const days = library.nextReview(card, rating).intervalDays;
    return [rating, days < 1 ? `${Math.round(days * 1440)}m` : `${Math.round(days)}d`];
  }));
}

function renderStudyCard() {
  const session = state.study;
  if (!session) return;
  if (session.index >= session.cards.length) {
    renderStudyComplete();
    return;
  }
  session.flipped = false;
  session.hintVisible = false;
  const card = session.cards[session.index];
  const intervals = ratingIntervals(card);
  byId('study-counter').textContent = `${session.index + 1} of ${session.cards.length}`;
  byId('study-progress-bar').value = (session.index / session.cards.length) * 100;
  byId('study-stage').innerHTML = `
    <div class="flip-scene">
      <button id="active-flashcard" class="flashcard" type="button" data-action="flip-card" aria-label="Flashcard front. Press to reveal the answer" aria-pressed="false">
        <span class="flash-face flash-front"><span class="face-label">QUESTION</span><p>${escapeHtml(card.front)}</p><span class="flip-note">click or press space to reveal</span></span>
        <span class="flash-face flash-back"><span class="face-label">ANSWER</span><p>${escapeHtml(card.back)}</p><span class="flip-note">rate your recall below</span></span>
      </button>
    </div>
    <div id="study-hint" class="study-hint">${card.hint ? '<button class="hint-button" type="button" data-action="toggle-hint">Need a hint?</button>' : '&nbsp;'}</div>
    <div class="rating-area">
      <div id="rating-controls" class="hidden">
        <p class="rating-prompt">How did that feel?</p>
        <div class="rating-buttons">
          <button class="rating-button rating-again" type="button" data-action="rate-card" data-rating="again"><b>Again</b><small>1 · ${intervals.again}</small></button>
          <button class="rating-button rating-hard" type="button" data-action="rate-card" data-rating="hard"><b>Hard</b><small>2 · ${intervals.hard}</small></button>
          <button class="rating-button rating-good" type="button" data-action="rate-card" data-rating="good"><b>Good</b><small>3 · ${intervals.good}</small></button>
          <button class="rating-button rating-easy" type="button" data-action="rate-card" data-rating="easy"><b>Easy</b><small>4 · ${intervals.easy}</small></button>
        </div>
      </div>
    </div>
    <p class="study-help">Space to flip · 1–4 to rate · Esc to leave</p>`;
  byId('active-flashcard').focus();
}

function flipCard() {
  if (!state.study || state.study.flipped) return;
  state.study.flipped = true;
  const card = byId('active-flashcard');
  card?.classList.add('is-flipped');
  card?.setAttribute('aria-pressed', 'true');
  card?.setAttribute('aria-label', 'Flashcard answer');
  byId('rating-controls')?.classList.remove('hidden');
}

function toggleHint() {
  const session = state.study;
  if (!session) return;
  const card = session.cards[session.index];
  session.hintVisible = true;
  byId('study-hint').textContent = card.hint;
}

async function rateCard(rating) {
  const session = state.study;
  if (!session || !session.flipped || session.saving) return;
  session.saving = true;
  const card = session.cards[session.index];
  $$('.rating-button').forEach((button) => { button.disabled = true; });
  try {
    const payload = await library.reviewCard(session.deckId, card.id, rating);
    if (state.study !== session || !state.currentDeck) return;
    const position = state.currentDeck.cards.findIndex((item) => item.id === card.id);
    if (position >= 0) state.currentDeck.cards[position] = payload.card;
    session.reviewed += 1;
    session.index += 1;
    window.setTimeout(() => { if (state.study === session) { session.saving = false; renderStudyCard(); } }, 170);
  } catch (error) {
    toast(error.message, 'error');
    session.saving = false;
    $$('.rating-button').forEach((button) => { button.disabled = false; });
  }
}

function renderStudyComplete() {
  byId('study-counter').textContent = 'Complete';
  byId('study-progress-bar').value = 100;
  byId('study-stage').innerHTML = `
    <section class="study-complete">
      <div class="completion-bloom" aria-hidden="true">✿</div>
      <h2>Session complete</h2>
      <p>You reviewed ${plural(state.study.reviewed, 'card')}. A little progress today becomes a lot of knowledge later.</p>
      <div class="completion-actions">
        <button class="button button-ghost" type="button" data-action="exit-study">Back to deck</button>
        <button class="button button-primary" type="button" data-action="study-again">Study again</button>
      </div>
    </section>`;
  refreshDecks().catch(() => {});
}

async function exitStudy() {
  const deckId = state.study?.deckId || state.currentDeck?.id;
  state.study = null;
  if (deckId) await openDeck(deckId);
  else showView('dashboard-view');
}

document.addEventListener('click', async (event) => {
  const closeButton = event.target.closest('[data-close]');
  if (closeButton) {
    byId(closeButton.dataset.close)?.close();
    return;
  }

  const themeButton = event.target.closest('[data-theme-choice]');
  if (themeButton) {
    setTheme(themeButton.dataset.themeChoice);
    byId('theme-menu').open = false;
    return;
  }

  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'dashboard') {
    state.currentDeck = null;
    state.study = null;
    renderDashboard();
    showView('dashboard-view');
  } else if (action === 'new-deck') {
    openDeckDialog();
  } else if (action === 'open-deck') {
    await openDeck(target.dataset.deckId);
  } else if (action === 'edit-deck') {
    openDeckDialog('edit');
  } else if (action === 'delete-deck') {
    const deck = state.currentDeck;
    openConfirm({
      title: 'Delete this deck?',
      message: `“${deck.title}” and all ${plural(deck.cardCount, 'card')} will be permanently deleted.`,
      action: async () => {
        await library.deleteDeck(deck.id);
        state.currentDeck = null;
        await refreshDecks();
        showView('dashboard-view');
        toast('Deck deleted.');
      },
    });
  } else if (action === 'new-card') {
    openCardDialog();
  } else if (action === 'edit-card') {
    openCardDialog(state.currentDeck?.cards.find((card) => card.id === target.dataset.cardId));
  } else if (action === 'delete-card') {
    const card = state.currentDeck.cards.find((item) => item.id === target.dataset.cardId);
    openConfirm({
      title: 'Delete this card?',
      message: `“${card.front.slice(0, 80)}${card.front.length > 80 ? '…' : ''}” will be permanently deleted.`,
      action: async () => {
        await library.deleteCard(state.currentDeck.id, card.id);
        await openDeck(state.currentDeck.id);
        await refreshDecks();
        toast('Card deleted.');
      },
    });
  } else if (action === 'study-deck') {
    await startStudy(target.dataset.deckId);
  } else if (action === 'flip-card') {
    flipCard();
  } else if (action === 'toggle-hint') {
    toggleHint();
  } else if (action === 'rate-card') {
    await rateCard(target.dataset.rating);
  } else if (action === 'exit-study') {
    await exitStudy();
  } else if (action === 'study-again') {
    const deckId = state.study.deckId;
    state.study = null;
    await startStudy(deckId);
  } else if (action === 'settings') {
    openSettings();
  } else if (action === 'retry-storage') {
    await init();
  } else if (action === 'export-deck') {
    try {
      const { deck } = await library.getDeck(state.currentDeck.id);
      const csv = target.dataset.format === 'csv';
      downloadFile(csv ? deckCSV(deck) : JSON.stringify({ version: 1, deck }, null, 2), `${safeFilename(deck.title)}.${csv ? 'csv' : 'json'}`, csv ? 'text/csv;charset=utf-8' : 'application/json');
    } catch (error) { toast(error.message, 'error'); }
  } else if (action === 'backup') {
    try {
      downloadFile(JSON.stringify(await library.backup(), null, 2), `petalcards-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    } catch (error) { toast(error.message, 'error'); }
  } else if (action === 'import') {
    byId('import-file').click();
  } else if (action === 'keep-storage') {
    const kept = await navigator.storage?.persist?.().catch(() => false);
    toast(kept ? 'Persistent storage enabled. Keep downloading backups too.' : 'Cards still save automatically. Download backups to keep another copy.');
  }
});

document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (event.key === '/' && !typing && state.profile && !state.study) {
    event.preventDefault();
    byId('deck-search').focus();
  }
  if (event.key === 'Escape' && state.study && !document.querySelector('dialog[open]')) exitStudy();
  if (!state.study || typing || document.querySelector('dialog[open]')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    flipCard();
  }
  if (state.study.flipped && ['1', '2', '3', '4'].includes(event.key)) {
    event.preventDefault();
    rateCard(['again', 'hard', 'good', 'easy'][Number(event.key) - 1]);
  }
});

byId('deck-grid').addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.deck-card')) {
    event.preventDefault();
    openDeck(event.target.dataset.deckId);
  }
});

byId('deck-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  delete values.id;
  setBusy(form, true);
  try {
    const payload = id
      ? await library.updateDeck(id, values)
      : await library.createDeck(values);
    byId('deck-dialog').close();
    await refreshDecks();
    await openDeck(payload.deck.id);
    toast(id ? 'Deck updated.' : 'Deck created — add your first card.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
});

byId('card-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  delete values.id;
  setBusy(form, true);
  try {
    if (id) await library.updateCard(state.currentDeck.id, id, values);
    else await library.createCard(state.currentDeck.id, values);
    byId('card-dialog').close();
    await openDeck(state.currentDeck.id);
    await refreshDecks();
    toast(id ? 'Card updated.' : 'Card added.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
});

byId('profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const payload = await library.setProfile(byId('profile-name').value);
    state.profile = payload.profile;
    updateHeader();
    toast('Name saved.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
});

$('#confirm-dialog form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId('confirm-button');
  button.disabled = true;
  try {
    await state.confirmAction?.();
    byId('confirm-dialog').close();
    state.confirmAction = null;
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

byId('deck-search').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderDashboard();
});

for (const dialog of $$('dialog')) {
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  });
}

byId('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 50 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 50 MB.');
    const payload = JSON.parse(await file.text());
    const count = await library.importLibrary(payload);
    await refreshDecks();
    toast(`Imported ${plural(count, 'deck')}. Your existing decks are unchanged.`);
  } catch (error) {
    toast(error instanceof SyntaxError ? 'This file is not valid JSON. Choose a Petalcards backup or deck export.' : error.message, 'error');
  } finally { event.target.value = ''; }
});

let copyingPreviousCards = false;
async function copyPreviousCards() {
  if (copyingPreviousCards || !navigator.onLine) return;
  copyingPreviousCards = true;
  try {
    const response = await fetch('/api/legacy-library', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
    const payload = await response.json();
    let count = 0;
    for (const source of payload.libraries || []) {
      count += await library.importLibrary(source, { sourceId: source.sourceId });
    }
    if (count) { await refreshDecks(); toast(`Saved ${plural(count, 'existing deck')} to this device.`); }
  } catch { /* An unavailable legacy server must never block local cards. Retry when online. */ }
  finally { copyingPreviousCards = false; }
}

async function init() {
  try {
    showApp(await library.initialize());
    copyPreviousCards();
  } catch (error) {
    byId('app-shell').classList.add('hidden');
    byId('boot-screen').classList.remove('hidden');
    byId('boot-screen').innerHTML = `<p>${escapeHtml(error.message)}</p><button class="button button-primary" type="button" data-action="retry-storage">Try again</button>`;
  }
}

// Refresh summaries when returning to a tab that may have been edited elsewhere.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.profile && !state.study && !document.querySelector('dialog[open]')) {
    refreshDecks().catch((error) => toast(error.message, 'error'));
    if (state.currentDeck) openDeck(state.currentDeck.id);
  }
});
window.addEventListener('online', copyPreviousCards);
init();
