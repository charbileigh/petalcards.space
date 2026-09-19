import { escapeHtml, richText, parseCards, readCardImage } from './content.js';
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
  ui: {}, progress: {}, backup: {}, savedSession: null,
  folder: '', tag: '', favorites: false,
  cardSearch: '', cardFavorites: false, cardPage: 0,
  frontImage: null, backImage: null, transferCardId: null, pendingDeckId: null,
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const byId = (id) => document.getElementById(id);

function toast(message, kind = 'success', undo = null) {
  const item = document.createElement('div');
  item.className = `toast ${kind === 'error' ? 'error' : ''}`;
  const text = document.createElement('span');
  text.textContent = message;
  item.append(text);
  if (undo) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Undo';
    button.addEventListener('click', async () => { button.disabled = true; try { await undo(); item.remove(); } catch (error) { toast(error.message, 'error'); button.disabled = false; } });
    item.append(button);
  }
  byId('toast-region').append(item);
  window.setTimeout(() => item.remove(), undo ? 10000 : 5000);
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
  const changed = byId(id).classList.contains('hidden');
  document.body.classList.toggle('study-focus', id === 'study-view' && state.ui.focus === true);
  $$('.view', byId('app-shell')).forEach((view) => view.classList.toggle('hidden', view.id !== id));
  if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
}

function updateHeader() {
  if (!state.profile) return;
  byId('user-avatar').textContent = initials(state.profile.name);
  byId('user-name-short').textContent = state.profile.name.split(/\s+/)[0];
  byId('greeting-name').textContent = state.profile.name.split(/\s+/)[0];
  byId('time-greeting').textContent = timeGreeting();
}

function showApp(payload) {
  applyPayload(payload);
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

function applyPayload(payload) {
  state.profile = payload.profile; state.decks = payload.decks; state.stats = payload.stats;
  state.ui = payload.ui || {}; state.progress = payload.progress || {}; state.backup = payload.backup || {};
  state.savedSession = payload.session;
  document.documentElement.dataset.cardSize = state.ui.cardSize || 'normal';
}

function renderDashboard() {
  updateHeader();
  for (const key of ['decks', 'cards', 'due']) byId(`stat-${key}`).textContent = state.stats[key];
  byId('stat-mastery').textContent = `${state.stats.mastery}%`;
  byId('deck-count-label').textContent = plural(state.decks.length, 'deck');
  const folders = [...new Set(state.decks.map((d) => d.folder).filter(Boolean))].sort();
  const tags = [...new Set(state.decks.flatMap((d) => d.tags || []))].sort();
  byId('folder-filter').innerHTML = '<option value="">All folders</option>' + folders.map((value) => `<option>${escapeHtml(value)}</option>`).join('');
  byId('tag-filter').innerHTML = '<option value="">All tags</option>' + tags.map((value) => `<option>${escapeHtml(value)}</option>`).join('');
  if (!folders.includes(state.folder)) state.folder = '';
  if (!tags.includes(state.tag)) state.tag = '';
  byId('folder-filter').value = state.folder; byId('tag-filter').value = state.tag;
  byId('favorite-filter').setAttribute('aria-pressed', String(state.favorites));
  const query = state.search.trim().toLowerCase();
  const visible = state.decks.filter((d) => (!query || (d.searchText || `${d.title} ${d.description}`.toLowerCase()).includes(query)) && (!state.folder || d.folder === state.folder) && (!state.tag || d.tags?.includes(state.tag)) && (!state.favorites || d.favorite));
  const grid = byId('deck-grid');
  grid.innerHTML = visible.map((deck) => `
    <article class="deck-card accent-${deck.accent}" data-action="open-deck" data-deck-id="${deck.id}" tabindex="0" aria-label="Open ${escapeHtml(deck.title)}">
      <div class="deck-cover"><span class="deck-bloom">✿</span><button class="favorite-button" type="button" data-action="favorite-deck" data-deck-id="${deck.id}" aria-label="Favourite ${escapeHtml(deck.title)}" aria-pressed="${Boolean(deck.favorite)}">${deck.favorite ? '★' : '☆'}</button></div>
      <div class="deck-body"><h3>${escapeHtml(deck.title)}</h3><p>${escapeHtml(deck.description || 'A collection ready to grow.')}</p>
        <div class="tag-list">${deck.folder ? `<span>▰ ${escapeHtml(deck.folder)}</span>` : ''}${(deck.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="deck-meta"><span>${plural(deck.cardCount, 'card')}</span><span>${deck.dueCount ? `${deck.dueCount} due` : 'All caught up'}</span></div>
        <div class="deck-progress"><progress max="100" value="${deck.mastery}" aria-label="${deck.mastery}% mastery"></progress></div>
      </div><button class="deck-study" type="button" data-action="study-deck" data-deck-id="${deck.id}" aria-label="Study ${escapeHtml(deck.title)}">▶</button>
    </article>`).join('');
  grid.classList.toggle('hidden', !visible.length);
  const filtering = Boolean(query || state.folder || state.tag || state.favorites);
  byId('empty-decks').classList.toggle('hidden', Boolean(state.decks.length || filtering));
  byId('no-search-results').classList.toggle('hidden', visible.length > 0 || !filtering);
  renderProgress(); renderBackupStatus(); renderResume();
}

function renderProgress() {
  const data = state.progress;
  byId('today-summary').textContent = `${plural(data.todayCards || 0, 'card')} reviewed today · ${data.todayReviews || 0} reviews`;
  const max = Math.max(1, ...(data.upcoming || []).map((d) => d.count));
  byId('upcoming-reviews').innerHTML = (data.upcoming || []).map((day, i) => `<div class="upcoming-row"><span>${i === 0 ? 'Today' : new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span><progress max="${max}" value="${day.count}" aria-label="${day.count} scheduled cards"></progress><b>${day.count}</b></div>`).join('');
  byId('difficult-cards').innerHTML = data.difficult?.length ? data.difficult.map((c) => `<button class="practice-link" type="button" data-action="find-card" data-deck-id="${c.deckId}" data-card-id="${c.id}"><b>${escapeHtml(c.front.slice(0, 90))}</b><small>${escapeHtml(c.deckTitle)} · ${c.lapses} Again ratings recorded</small></button>`).join('') : '<p class="field-note">Cards that need more practice will appear here as you study.</p>';
}

function renderBackupStatus() {
  const backup = state.backup;
  const changes = Math.max(0, (backup.revision || 0) - (backup.backupRevision || 0));
  const last = backup.backupAt ? new Date(backup.backupAt).toLocaleString() : 'No backup exported yet';
  byId('last-backup').textContent = `Last backup export: ${last}. ${changes} changes since then.`;
  const due = changes >= 20 || (changes > 0 && backup.backupAt && Date.now() - backup.backupAt > 7 * 86400000) || (!backup.backupAt && changes >= 5);
  byId('backup-reminder').classList.toggle('hidden', !due || (backup.backupSnooze || 0) > Date.now());
  byId('backup-reminder-text').textContent = `${changes} changes since your last backup. Save a copy before clearing site data or changing devices.`;
}

function renderResume() {
  const session = state.savedSession;
  const deck = session && state.decks.find((d) => d.id === session.deckId);
  const finished = session && session.cardIds.every((id) => session.ratings[id]);
  byId('resume-banner').classList.toggle('hidden', !deck || finished);
  if (deck) byId('resume-text').textContent = `${deck.title} · ${Object.keys(session.ratings).length} of ${session.cardIds.length} rated`;
}

async function refreshDecks() {
  applyPayload(await library.dashboard());
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

  renderCards();
}

function renderCards() {
  const deck = state.currentDeck;
  if (!deck) return;
  const query = state.cardSearch.trim().toLowerCase();
  const visible = deck.cards.filter((c) => (!state.cardFavorites || c.favorite) && (!query || [c.front, c.back, c.hint, ...(c.tags || [])].join(' ').toLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  state.cardPage = Math.min(state.cardPage, pages - 1);
  const start = state.cardPage * 20;
  const list = byId('card-list');
  list.innerHTML = visible.slice(start, start + 20).map((card, index) => `
    <article class="library-card" data-card-id="${card.id}" tabindex="-1">
      <div class="card-copy"><small>FRONT · ${start + index + 1}${card.frontImage ? ' · IMAGE' : ''}</small><p>${escapeHtml(card.front)}</p><div class="tag-list">${(card.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div>
      <span class="divider" aria-hidden="true"></span><div class="card-copy"><small>BACK · ${formatDue(card)}${card.backImage ? ' · IMAGE' : ''}</small><p>${escapeHtml(card.back)}</p></div>
      <div class="card-tools"><button class="tiny-button" type="button" data-action="favorite-card" data-card-id="${card.id}" aria-label="Favourite card" aria-pressed="${Boolean(card.favorite)}">${card.favorite ? '★' : '☆'}</button><button class="tiny-button" type="button" data-action="edit-card" data-card-id="${card.id}" aria-label="Edit card">✎</button><button class="tiny-button" type="button" data-action="transfer-card" data-card-id="${card.id}" aria-label="Move or copy card">⇄</button><button class="tiny-button danger" type="button" data-action="delete-card" data-card-id="${card.id}" aria-label="Delete card">×</button></div>
    </article>`).join('');
  byId('card-results').textContent = visible.length ? `Showing ${start + 1}–${Math.min(start + 20, visible.length)} of ${plural(visible.length, 'card')}` : deck.cards.length ? 'No matching cards. Try another search or turn off favourites.' : '';
  list.classList.toggle('hidden', !visible.length);
  byId('empty-cards').classList.toggle('hidden', deck.cards.length !== 0);
  byId('card-pagination').classList.toggle('hidden', pages === 1);
  byId('card-page-label').textContent = `Page ${state.cardPage + 1} of ${pages}`;
  byId('cards-prev').disabled = state.cardPage === 0; byId('cards-next').disabled = state.cardPage + 1 >= pages;
  byId('card-favorite-filter').setAttribute('aria-pressed', String(state.cardFavorites));
}

async function openDeck(deckId) {
  try {
    const payload = await library.getDeck(deckId);
    if (state.currentDeck?.id !== deckId) { state.cardPage = 0; state.cardSearch = ''; state.cardFavorites = false; byId('card-search').value = ''; }
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
  byId('deck-folder').value = deck?.folder || '';
  byId('deck-tags').value = (deck?.tags || []).join(', ');
  byId('folder-options').innerHTML = [...new Set(state.decks.map((d) => d.folder).filter(Boolean))].map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
  const accent = deck?.accent || 'rose';
  $$('#deck-form input[name="accent"]').forEach((input) => { input.checked = input.value === accent; });
  byId('deck-dialog').showModal();
  byId('deck-title').focus();
}

let imageEditVersion = 0;
function openCardDialog(card = null) {
  imageEditVersion++;
  byId('card-dialog-title').textContent = card ? 'Edit this card' : 'Add a card';
  byId('card-submit').textContent = card ? 'Save changes' : 'Add card';
  byId('card-id').value = card?.id || '';
  byId('card-front').value = card?.front || '';
  byId('card-back').value = card?.back || '';
  byId('card-hint').value = card?.hint || '';
  byId('card-tags').value = (card?.tags || []).join(', ');
  state.frontImage = card?.frontImage || null; state.backImage = card?.backImage || null;
  byId('front-image-file').value = ''; byId('back-image-file').value = '';
  renderEditorImages();
  if (!byId('card-dialog').open) byId('card-dialog').showModal();
  byId('card-front').focus();
}

function openSettings() {
  byId('profile-name').value = state.profile.name === 'friend' ? '' : state.profile.name;
  byId('card-text-size').value = state.ui.cardSize || 'normal';
  byId('focus-setting').checked = state.ui.focus === true;
  renderBackupStatus();
  byId('settings-dialog').showModal();
}

function openConfirm({ title, message, confirmText = 'Delete', action }) {
  byId('confirm-title').textContent = title;
  byId('confirm-message').textContent = message;
  byId('confirm-button').textContent = confirmText;
  state.confirmAction = action;
  byId('confirm-dialog').showModal();
}

async function startStudy(deckId) {
  try {
    const { deck } = await library.getDeck(deckId);
    if (!deck.cards.length) { toast('Add at least one card before studying.', 'error'); await openDeck(deckId); return; }
    state.pendingDeckId = deckId;
    state.savedSession = await library.getSession();
    const saved = state.savedSession && !state.savedSession.cardIds.every((id) => state.savedSession.ratings[id]);
    byId('study-options-note').textContent = saved ? `A session in “${state.savedSession.deckTitle}” is saved. You can resume it, or start a new session here.` : `${deck.title} · ${plural(deck.cards.length, 'card')}. Moving between cards does not grade them.`;
    byId('study-resume-option').classList.toggle('hidden', !saved);
    byId('study-mode').value = deck.dueCount ? 'due' : 'all';
    byId('study-start').textContent = saved ? 'Start a new session' : 'Start session';
    byId('study-options-dialog').showModal();
  } catch (error) { toast(error.message, 'error'); }
}

async function mountSession(session) {
  if (!session) throw new Error('There is no saved study session yet.');
  const { deck } = await library.getDeck(session.deckId);
  const currentId = session.cardIds[session.index];
  const available = new Set(deck.cards.map((c) => c.id));
  session.cardIds = session.cardIds.filter((id) => available.has(id));
  if (!session.cardIds.length) throw new Error('These cards have been moved or deleted. Start another session.');
  session.ratings = Object.fromEntries(Object.entries(session.ratings).filter(([id]) => available.has(id)));
  session.index = currentId && available.has(currentId) ? session.cardIds.indexOf(currentId) : Math.min(session.index, session.cardIds.length);
  state.study = await library.saveSession(session);
  state.currentDeck = deck;
  byId('study-options-dialog').close();
  byId('study-deck-name').textContent = deck.title;
  showView('study-view'); renderStudyCard();
}

function currentStudyCard() {
  return state.currentDeck?.cards.find((card) => card.id === state.study?.cardIds[state.study.index]);
}

function cardFace(text, image, label, className, hidden) {
  return `<span id="${className}-face" class="flash-face ${className}" aria-hidden="${hidden}"><span class="face-label">${label}</span><span class="rich-card-content">${image ? `<img class="study-image" src="${image.src}" alt="${escapeHtml(image.alt || 'Card illustration')}">` : ''}<span>${richText(text)}</span></span></span>`;
}

function renderStudyCard() {
  const session = state.study;
  if (!session) return;
  if (session.index >= session.cardIds.length) { renderStudyComplete(); return; }
  const card = currentStudyCard();
  if (!card) { toast('This card is no longer available. Reopen your session.', 'error'); return; }
  const reviewed = Object.keys(session.ratings).length;
  byId('study-counter').textContent = `Card ${session.index + 1} of ${session.cardIds.length} · ${reviewed} rated`;
  byId('study-progress-bar').value = 100 * reviewed / session.cardIds.length;
  const first = session.reverse ? { text: card.back, image: card.backImage, label: 'ANSWER' } : { text: card.front, image: card.frontImage, label: 'QUESTION' };
  const second = session.reverse ? { text: card.front, image: card.frontImage, label: 'QUESTION' } : { text: card.back, image: card.backImage, label: 'ANSWER' };
  const rated = session.ratings[card.id];
  const sessionCards = new Map(state.currentDeck.cards.map((item) => [item.id, item]));
  byId('study-stage').innerHTML = `
    <div class="study-toolbar"><label>Jump to card <select id="study-jump">${session.cardIds.map((id, i) => `<option value="${i}" ${i === session.index ? 'selected' : ''}>${i + 1}. ${escapeHtml((sessionCards.get(id)?.front || 'Card').slice(0, 55))}${session.ratings[id] ? ' ✓' : ''}</option>`).join('')}</select></label><button class="button button-ghost" type="button" data-action="focus-study" aria-pressed="${Boolean(state.ui.focus)}">${state.ui.focus ? 'Show navigation' : 'Focus view'}</button></div>
    <div class="flip-scene card-enter"><button id="active-flashcard" class="flashcard ${session.flipped ? 'is-flipped' : ''}" type="button" data-action="flip-card" aria-labelledby="${session.flipped ? 'flash-back-face' : 'flash-front-face'}" aria-description="Press to reveal the other side." aria-label="${session.flipped ? 'Answer revealed. Flip back' : 'Reveal the other side'}" aria-pressed="${Boolean(session.flipped)}">${cardFace(first.text, first.image, first.label, 'flash-front', Boolean(session.flipped))}${cardFace(second.text, second.image, second.label, 'flash-back', !session.flipped)}</button></div>
    <div class="study-navigation"><button class="button button-ghost" type="button" data-action="previous-card" ${session.index === 0 ? 'disabled' : ''}>← Previous</button><button class="button button-secondary" type="button" data-action="flip-card">${session.flipped ? 'Show first side' : 'Reveal answer'}</button><button class="button button-ghost" type="button" data-action="next-card">${session.index + 1 === session.cardIds.length ? 'Finish' : 'Next →'}</button></div>
    <div id="study-hint" class="study-hint">${card.hint ? '<button class="hint-button" type="button" data-action="toggle-hint">Show hint</button>' : ''}</div>
    <div class="rating-area"><div id="rating-controls" class="${!session.flipped ? 'concealed' : ''}"><p class="rating-prompt">${rated ? `Rated ${escapeHtml(rated)} · already saved for this session` : 'How did that feel?'}</p><div class="rating-buttons">${['again', 'hard', 'good', 'easy'].map((rating, i) => { const days = library.nextReview(card, rating).intervalDays; const interval = days < 1 ? `${Math.round(days * 1440)}m` : `${Math.round(days)}d`; return `<button class="rating-button rating-${rating}" type="button" data-action="rate-card" data-rating="${rating}" ${rated ? 'disabled' : ''}><b>${rating[0].toUpperCase() + rating.slice(1)}</b><small>${i + 1} · ${interval}</small></button>`; }).join('')}</div></div></div>
    <p class="study-help">Space to flip · ← → to move · 1–4 to rate · swipe to move on touch screens<br>Navigation never changes a rating. Your position saves automatically.</p>`;
  byId('active-flashcard').focus({ preventScroll: true });
}

async function flipCard() {
  const session = state.study;
  if (!session || session.saving || session.index >= session.cardIds.length || Date.now() < (state.suppressFlipUntil || 0)) return;
  session.saving = true;
  try {
    const next = await library.saveSession({ ...session, flipped: !session.flipped });
    if (state.study !== session) return;
    state.study = next;
    const element = byId('active-flashcard');
    element.classList.toggle('is-flipped', next.flipped);
    element.setAttribute('aria-pressed', String(next.flipped));
    element.setAttribute('aria-labelledby', next.flipped ? 'flash-back-face' : 'flash-front-face');
    element.setAttribute('aria-label', next.flipped ? 'Answer revealed. Flip back' : 'Reveal the other side');
    $('.flash-front', element).setAttribute('aria-hidden', String(next.flipped));
    $('.flash-back', element).setAttribute('aria-hidden', String(!next.flipped));
    byId('rating-controls').classList.toggle('concealed', !next.flipped);
    $('.study-navigation [data-action="flip-card"]').textContent = next.flipped ? 'Show first side' : 'Reveal answer';
  } catch (error) { session.saving = false; toast(error.message, 'error'); }
}

async function navigateStudy(index) {
  const session = state.study;
  if (!session || session.saving) return;
  const nextIndex = Math.max(0, Math.min(index, session.cardIds.length));
  session.saving = true;
  try {
    const next = await library.saveSession({ ...session, index: nextIndex, flipped: false });
    if (state.study !== session) return;
    state.study = next; renderStudyCard();
  } catch (error) { session.saving = false; toast(error.message, 'error'); }
}

function toggleHint() {
  const card = currentStudyCard();
  if (card) byId('study-hint').textContent = card.hint;
}

async function rateCard(rating) {
  const session = state.study;
  const card = currentStudyCard();
  if (!session || !card || !session.flipped || session.saving || session.ratings[card.id]) return;
  session.saving = true;
  $$('.rating-button').forEach((button) => { button.disabled = true; });
  try {
    const payload = await library.reviewCard(session.deckId, card.id, rating, session.id);
    if (state.study !== session) return;
    state.currentDeck.cards[state.currentDeck.cards.findIndex((c) => c.id === card.id)] = payload.card;
    state.study = payload.session; renderStudyCard();
  } catch (error) { session.saving = false; toast(error.message, 'error'); renderStudyCard(); }
}

function renderStudyComplete() {
  const session = state.study;
  const reviewed = Object.keys(session.ratings).length;
  const remaining = session.cardIds.length - reviewed;
  byId('study-counter').textContent = `${reviewed} of ${session.cardIds.length} rated`;
  byId('study-progress-bar').value = 100 * reviewed / session.cardIds.length;
  byId('study-stage').innerHTML = `<section class="study-complete"><div class="completion-bloom" aria-hidden="true">✿</div><h2>${remaining ? 'A good place to pause' : 'Session complete'}</h2><p>You reviewed ${plural(reviewed, 'card')}.${remaining ? ` ${plural(remaining, 'card')} left unrated. Their schedules have not changed.` : ' Your progress is saved.'}</p><div class="completion-actions">${remaining ? '<button class="button button-primary" type="button" data-action="study-remaining">Review remaining</button>' : ''}<button class="button button-ghost" type="button" data-action="previous-card">← Revisit last card</button><button class="button button-secondary" type="button" data-action="exit-study">Back to deck</button></div></section>`;
  refreshDecks().catch((error) => toast(error.message, 'error'));
}

async function exitStudy() {
  if (state.study?.saving) return;
  const deckId = state.study?.deckId || state.currentDeck?.id;
  state.study = null;
  await refreshDecks();
  if (deckId) await openDeck(deckId);
  else showView('dashboard-view');
}

function renderEditorImages() {
  for (const side of ['front', 'back']) {
    const image = state[`${side}Image`];
    const preview = byId(`${side}-image-preview`);
    preview.classList.toggle('hidden', !image);
    if (image) preview.src = image.src; else preview.removeAttribute('src');
    byId(`${side}-image-alt`).value = image?.alt || '';
  }
}

async function refreshCurrentDeck() {
  if (state.currentDeck) { state.currentDeck = (await library.getDeck(state.currentDeck.id)).deck; renderDeck(); }
  await refreshDecks();
}

function clearCardFilters() {
  state.cardSearch = ''; state.cardFavorites = false; byId('card-search').value = '';
}

async function showTrash() {
  const items = await library.getTrash();
  byId('trash-list').innerHTML = items.length ? items.map((item) => `<div class="trash-item"><div><b>${escapeHtml(item.kind === 'deck' ? item.deck.title : item.card.front.slice(0, 100))}</b><p>${item.kind === 'deck' ? plural(item.deck.cards.length, 'card') : `Card from ${escapeHtml(item.deck.title)}`} · ${new Date(item.deletedAt).toLocaleDateString()}</p></div><button class="button button-secondary" type="button" data-action="restore-trash" data-trash-id="${item.id}">Restore</button></div>`).join('') : '<p class="empty-state compact">Your recycle bin is empty.</p>';
  byId('empty-trash').disabled = !items.length;
  if (!byId('trash-dialog').open) byId('trash-dialog').showModal();
}

function showBulk({ text = '', title = 'Imported cards', newDeck = false } = {}) {
  byId('bulk-target').innerHTML = '<option value="new">Create a new deck</option>' + state.decks.map((d) => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');
  byId('bulk-target').value = !newDeck && state.currentDeck ? state.currentDeck.id : 'new';
  byId('bulk-title').value = title;
  byId('bulk-text').value = text; byId('bulk-separator').value = 'auto'; byId('bulk-file').value = '';
  byId('bulk-preview').replaceChildren(); updateBulkTarget();
  byId('bulk-dialog').showModal();
}

function updateBulkTarget() {
  const isNew = byId('bulk-target').value === 'new';
  byId('bulk-title-wrap').classList.toggle('hidden', !isNew); byId('bulk-title').required = isNew;
}

function parsedBulk() {
  const separator = byId('bulk-separator').value;
  return parseCards(byId('bulk-text').value, separator === 'tab' ? '\t' : separator);
}

function previewBulk() {
  try {
    const cards = parsedBulk();
    byId('bulk-preview').innerHTML = `<p><b>${plural(cards.length, 'card')} ready to add.</b>${cards.length > 5 ? ' First five shown below.' : ''}</p><table><thead><tr><th>Question</th><th>Answer</th></tr></thead><tbody>${cards.slice(0, 5).map((c) => `<tr><td>${escapeHtml(c.front)}</td><td>${escapeHtml(c.back)}</td></tr>`).join('')}</tbody></table>`;
  } catch (error) { byId('bulk-preview').textContent = error.message; }
}

async function downloadBackup() {
  const payload = await library.backup();
  downloadFile(JSON.stringify(payload, null, 2), `petalcards-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  await library.markBackup(payload.revision);
  await refreshDecks();
  toast('Backup export started. Keep the downloaded file somewhere safe.');
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
  try {
  if (action === 'dashboard') {
    if (state.study?.saving) return;
    state.currentDeck = null;
    state.study = null;
    await refreshDecks();
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
      message: `“${deck.title}” and all ${plural(deck.cardCount, 'card')} will move to the recycle bin. You can restore them later.`,
      confirmText: 'Move to bin',
      action: async () => {
        const deleted = await library.deleteDeck(deck.id);
        state.currentDeck = null;
        await refreshDecks();
        showView('dashboard-view');
        toast('Deck moved to the recycle bin.', 'success', async () => { await library.restoreTrash(deleted.id); await refreshDecks(); });
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
      message: `“${card.front.slice(0, 80)}${card.front.length > 80 ? '…' : ''}” will move to the recycle bin.`,
      confirmText: 'Move to bin',
      action: async () => {
        const deleted = await library.deleteCard(state.currentDeck.id, card.id);
        await openDeck(state.currentDeck.id);
        await refreshDecks();
        toast('Card moved to the recycle bin.', 'success', async () => { await library.restoreTrash(deleted.id); await refreshCurrentDeck(); });
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
  } else if (action === 'previous-card') {
    await navigateStudy(state.study.index - 1);
  } else if (action === 'next-card') {
    await navigateStudy(state.study.index + 1);
  } else if (action === 'study-remaining') {
    await navigateStudy(state.study.cardIds.findIndex((id) => !state.study.ratings[id]));
  } else if (action === 'resume-study') {
    await mountSession(await library.getSession());
  } else if (action === 'focus-study') {
    state.ui = await library.setUI({ ...state.ui, focus: !state.ui.focus });
    document.body.classList.toggle('study-focus', state.ui.focus); renderStudyCard();
  } else if (action === 'settings') {
    openSettings();
  } else if (action === 'retry-storage') {
    await init();
  } else if (action === 'export-deck') {
    try {
      const { deck } = await library.getDeck(state.currentDeck.id);
      const csv = target.dataset.format === 'csv';
      downloadFile(csv ? deckCSV(deck) : JSON.stringify({ version: 2, deck }, null, 2), `${safeFilename(deck.title)}.${csv ? 'csv' : 'json'}`, csv ? 'text/csv;charset=utf-8' : 'application/json');
    } catch (error) { toast(error.message, 'error'); }
  } else if (action === 'backup') {
    await downloadBackup();
  } else if (action === 'import') {
    byId('import-file').click();
  } else if (action === 'snooze-backup') {
    await library.snoozeBackup(); await refreshDecks();
  } else if (action === 'bulk-add') {
    showBulk();
  } else if (action === 'preview-bulk') {
    previewBulk();
  } else if (action === 'trash') {
    await showTrash();
  } else if (action === 'restore-trash') {
    target.disabled = true;
    try { await library.restoreTrash(target.dataset.trashId); await showTrash(); await refreshCurrentDeck(); toast('Restored to your collection.'); }
    finally { target.disabled = false; }
  } else if (action === 'empty-trash') {
    openConfirm({ title: 'Empty the recycle bin?', message: 'Permanently remove every item in the bin? This cannot be undone.', confirmText: 'Empty bin', action: async () => { await library.emptyTrash(); await showTrash(); } });
  } else if (action === 'favorite-deck') {
    await library.toggleFavorite(target.dataset.deckId); await refreshDecks();
  } else if (action === 'favorite-card') {
    await library.toggleFavorite(state.currentDeck.id, target.dataset.cardId); await refreshCurrentDeck();
  } else if (action === 'filter-favorites') {
    state.favorites = !state.favorites; renderDashboard();
  } else if (action === 'filter-card-favorites') {
    state.cardFavorites = !state.cardFavorites; state.cardPage = 0; renderCards();
  } else if (action === 'cards-prev' || action === 'cards-next') {
    state.cardPage += action === 'cards-prev' ? -1 : 1; renderCards(); byId('card-list').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } else if (action === 'transfer-card') {
    state.transferCardId = target.dataset.cardId;
    byId('transfer-target').innerHTML = state.decks.map((d) => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');
    byId('transfer-target').value = state.decks.find((d) => d.id !== state.currentDeck.id)?.id || state.currentDeck.id;
    byId('transfer-mode').value = state.decks.length === 1 ? 'copy' : 'move';
    byId('transfer-dialog').showModal();
  } else if (action === 'find-card') {
    await openDeck(target.dataset.deckId); clearCardFilters();
    state.cardPage = Math.floor(state.currentDeck.cards.findIndex((c) => c.id === target.dataset.cardId) / 20); renderCards();
    const row = document.querySelector(`.library-card[data-card-id="${target.dataset.cardId}"]`); row?.focus(); row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (action === 'remove-image') {
    state[`${target.dataset.side}Image`] = null; renderEditorImages();
  } else if (action === 'keep-storage') {
    const kept = await navigator.storage?.persist?.().catch(() => false);
    toast(kept ? 'Persistent storage enabled. Keep downloading backups too.' : 'Cards still save automatically. Download backups to keep another copy.');
  }
  } catch (error) { toast(error.message, 'error'); }
});

document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key === '/' && !typing && state.profile && !state.study && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    byId('deck-search').focus();
  }
  if (event.key === 'Escape' && state.study && !document.querySelector('dialog[open]')) exitStudy();
  if (!state.study || typing || document.querySelector('dialog[open]')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigateStudy(state.study.index + (event.key === 'ArrowRight' ? 1 : -1)); return; }
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
  if (pendingImages) return;
  const another = event.submitter?.id === 'card-add-another';
  values.frontImage = state.frontImage ? { ...state.frontImage, alt: byId('front-image-alt').value } : null;
  values.backImage = state.backImage ? { ...state.backImage, alt: byId('back-image-alt').value } : null;
  setBusy(form, true);
  try {
    if (id) await library.updateCard(state.currentDeck.id, id, values);
    else await library.createCard(state.currentDeck.id, values);
    clearCardFilters();
    await refreshCurrentDeck();
    if (another) { openCardDialog(); window.setTimeout(() => byId('card-front').focus(), 0); }
    else { byId('card-dialog').close(); if (!id) { state.cardPage = Math.max(0, Math.ceil(state.currentDeck.cards.length / 20) - 1); renderCards(); } }
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
    if (file.size > 50 * 1024 * 1024) throw new Error('Choose a file smaller than 50 MB.');
    const content = await file.text();
    if (/\.(csv|tsv)$/i.test(file.name)) { showBulk({ text: content, title: file.name.replace(/\.[^.]+$/, ''), newDeck: true }); previewBulk(); return; }
    const payload = JSON.parse(content);
    const count = await library.importLibrary(payload);
    await refreshDecks();
    toast(`Imported ${plural(count, 'deck')}. Your existing decks are unchanged.`);
  } catch (error) {
    toast(error instanceof SyntaxError ? 'This file is not valid JSON. Choose a Petalcards backup or deck export.' : error.message, 'error');
  } finally { event.target.value = ''; }
});

byId('folder-filter').addEventListener('change', (event) => { state.folder = event.target.value; renderDashboard(); });
byId('tag-filter').addEventListener('change', (event) => { state.tag = event.target.value; renderDashboard(); });
byId('card-search').addEventListener('input', (event) => { state.cardSearch = event.target.value; state.cardPage = 0; renderCards(); });
byId('bulk-target').addEventListener('change', updateBulkTarget);
byId('bulk-text').addEventListener('input', () => byId('bulk-preview').replaceChildren());
byId('bulk-separator').addEventListener('change', () => byId('bulk-preview').replaceChildren());
byId('bulk-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a CSV or TSV file under 10 MB.');
    byId('bulk-text').value = await file.text(); previewBulk();
  } catch (error) { toast(error.message, 'error'); }
});

byId('bulk-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget;
  setBusy(form, true);
  try {
    const cards = parsedBulk();
    let deckId = byId('bulk-target').value;
    if (deckId === 'new') deckId = (await library.createDeck({ title: byId('bulk-title').value, cards })).deck.id;
    else await library.addCards(deckId, cards);
    byId('bulk-dialog').close(); await refreshDecks(); clearCardFilters();
    await openDeck(deckId); state.cardPage = Math.max(0, Math.ceil(state.currentDeck.cards.length / 20) - 1); renderCards();
    toast(`Added ${plural(cards.length, 'card')}.`);
  } catch (error) { toast(error.message, 'error'); byId('bulk-preview').textContent = error.message; }
  finally { setBusy(form, false); }
});

byId('transfer-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try {
    const copy = byId('transfer-mode').value === 'copy';
    await library.transferCard(state.currentDeck.id, state.transferCardId, byId('transfer-target').value, copy);
    byId('transfer-dialog').close(); await refreshCurrentDeck(); toast(copy ? 'Card copied with fresh study progress.' : 'Card moved with its study progress.');
  } catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

byId('study-options-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try {
    const session = await library.beginSession(state.pendingDeckId, { mode: byId('study-mode').value, limit: byId('study-limit').value, shuffle: byId('study-shuffle').checked, reverse: byId('study-reverse').checked });
    await mountSession(session);
  } catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'study-jump') navigateStudy(Number(event.target.value));
});
let touchStart;
byId('study-stage').addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' && event.target.closest('.flip-scene')) touchStart = { x: event.clientX, y: event.clientY };
});
byId('study-stage').addEventListener('pointercancel', () => { touchStart = null; });
byId('study-stage').addEventListener('pointerup', (event) => {
  if (!touchStart || !state.study) return;
  const dx = event.clientX - touchStart.x, dy = event.clientY - touchStart.y; touchStart = null;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    state.suppressFlipUntil = Date.now() + 450;
    navigateStudy(state.study.index + (dx < 0 ? 1 : -1));
  }
});

byId('accessibility-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try {
    state.ui = await library.setUI({ cardSize: byId('card-text-size').value, focus: byId('focus-setting').checked });
    document.documentElement.dataset.cardSize = state.ui.cardSize;
    document.body.classList.toggle('study-focus', Boolean(state.study && state.ui.focus));
    toast('Reading settings saved.');
  } catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

let pendingImages = 0;
for (const side of ['front', 'back']) {
  byId(`${side}-image-alt`).addEventListener('input', (event) => { if (state[`${side}Image`]) state[`${side}Image`].alt = event.target.value; });
  byId(`${side}-image-file`).addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const editVersion = imageEditVersion;
    pendingImages++;
    byId('card-submit').disabled = byId('card-add-another').disabled = true;
    try { const image = await readCardImage(file); if (editVersion !== imageEditVersion || !byId('card-dialog').open) return; image.alt = byId(`${side}-image-alt`).value; state[`${side}Image`] = image; renderEditorImages(); }
    catch (error) { toast(error.message, 'error'); }
    finally { pendingImages--; byId('card-submit').disabled = byId('card-add-another').disabled = pendingImages > 0; event.target.value = ''; }
  });
}

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
