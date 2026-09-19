const THEMES = ['pink', 'purple', 'blue', 'green', 'berry', 'grey'];
const state = {
  user: null,
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

async function request(path, options = {}) {
  const init = { method: options.method || 'GET', headers: { Accept: 'application/json' } };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }
  return payload;
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
  state.theme = selected;
  document.documentElement.dataset.theme = selected;
  localStorage.setItem('petalcards-theme', selected);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected === 'pink' ? '#fffafd' : '#16121f');
  $$('[data-theme-choice]').forEach((button) => button.classList.toggle('active', button.dataset.themeChoice === selected));
  if (save && state.user) request('/api/preferences', { method: 'PATCH', body: { theme: selected } }).catch(() => {});
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
  if (!state.user) return;
  byId('user-avatar').textContent = initials(state.user.name);
  byId('user-name-short').textContent = state.user.name.split(/\s+/)[0];
  byId('greeting-name').textContent = state.user.name.split(/\s+/)[0];
  byId('time-greeting').textContent = timeGreeting();
}

function showApp(payload) {
  state.user = payload.user;
  state.decks = payload.decks || [];
  state.stats = payload.stats || { decks: 0, cards: 0, due: 0, mastery: 0 };
  byId('boot-screen').classList.add('hidden');
  byId('landing-view').classList.add('hidden');
  byId('app-shell').classList.remove('hidden');
  setTheme(payload.theme || localStorage.getItem('petalcards-theme') || 'pink', { save: false });
  updateHeader();
  renderDashboard();
  showView('dashboard-view');
}

function showLanding() {
  state.user = null;
  state.decks = [];
  state.currentDeck = null;
  byId('boot-screen').classList.add('hidden');
  byId('app-shell').classList.add('hidden');
  byId('landing-view').classList.remove('hidden');
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
  const payload = await request('/api/decks');
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
          <a href="/api/decks/${encodeURIComponent(deck.id)}/export?format=csv" download>Download CSV</a>
          <a href="/api/decks/${encodeURIComponent(deck.id)}/export?format=json" download>Download JSON</a>
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
    const payload = await request(`/api/decks/${encodeURIComponent(deckId)}`);
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
  byId('profile-name').value = state.user.name;
  const guest = state.user.guest;
  byId('profile-email').value = state.user.email || '';
  byId('profile-email').closest('label').classList.toggle('hidden', guest);
  byId('password-form').classList.toggle('hidden', guest);
  byId('account-actions').classList.toggle('hidden', guest);
  byId('guest-settings').classList.toggle('hidden', !guest);
  byId('settings-dialog').showModal();
}

function openConfirm({ title, message, confirmText = 'Delete', password = false, action }) {
  byId('confirm-title').textContent = title;
  byId('confirm-message').textContent = message;
  byId('confirm-button').textContent = confirmText;
  byId('confirm-password-wrap').classList.toggle('hidden', !password);
  byId('confirm-password').required = password;
  byId('confirm-password').value = '';
  state.confirmAction = action;
  byId('confirm-dialog').showModal();
  if (password) byId('confirm-password').focus();
}

function dueCards(cards) {
  const now = Date.now();
  return cards.filter((card) => !card.dueAt || card.dueAt <= now);
}

async function startStudy(deckId) {
  try {
    if (!state.currentDeck || state.currentDeck.id !== deckId) {
      const payload = await request(`/api/decks/${encodeURIComponent(deckId)}`);
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
  const current = Number(card.intervalDays || 0);
  const good = current < 1 ? 1 : Math.max(1, Math.round(current * 2.5));
  const easy = current < 1 ? 4 : Math.max(4, Math.round(current * 3.25));
  return { again: '10m', hard: current < 1 ? '1d' : `${Math.max(1, Math.round(current * 1.2))}d`, good: `${good}d`, easy: `${easy}d` };
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
  if (!session || !session.flipped) return;
  const card = session.cards[session.index];
  $$('.rating-button').forEach((button) => { button.disabled = true; });
  try {
    const payload = await request(`/api/cards/${encodeURIComponent(card.id)}/review`, { method: 'POST', body: { rating } });
    const position = state.currentDeck.cards.findIndex((item) => item.id === card.id);
    if (position >= 0) state.currentDeck.cards[position] = payload.card;
    session.reviewed += 1;
    session.index += 1;
    window.setTimeout(renderStudyCard, 170);
  } catch (error) {
    toast(error.message, 'error');
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

async function logout() {
  try { await request('/api/auth/logout', { method: 'POST', body: {} }); } catch {}
  byId('settings-dialog').close();
  await init();
  toast('You are signed out.');
}

function switchAuthTab(tab) {
  const login = tab === 'login';
  byId('login-tab').classList.toggle('active', login);
  byId('register-tab').classList.toggle('active', !login);
  byId('login-tab').setAttribute('aria-selected', String(login));
  byId('register-tab').setAttribute('aria-selected', String(!login));
  byId('login-form').classList.toggle('hidden', !login);
  byId('register-form').classList.toggle('hidden', login);
  byId('auth-heading').textContent = login ? 'Welcome back' : 'Make a little space';
  byId('auth-subtitle').textContent = login ? 'Your next study session is waiting.' : 'Your first deck is only a minute away.';
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
        await request(`/api/decks/${encodeURIComponent(deck.id)}`, { method: 'DELETE', body: {} });
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
        await request(`/api/cards/${encodeURIComponent(card.id)}`, { method: 'DELETE', body: {} });
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
  } else if (action === 'existing-account') {
    byId('settings-dialog').close();
    showLanding();
    switchAuthTab('login');
  } else if (action === 'continue-guest') {
    await init();
  } else if (action === 'logout') {
    await logout();
  } else if (action === 'delete-account') {
    openConfirm({
      title: 'Delete your account?',
      message: 'Every deck, card, and review will be permanently deleted. Enter your password to confirm.',
      confirmText: 'Delete my account',
      password: true,
      action: async (password) => {
        await request('/api/account', { method: 'DELETE', body: { password } });
        byId('settings-dialog').close();
        await init();
        toast('Your account was deleted.');
      },
    });
  }
});

document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (event.key === '/' && !typing && state.user && !state.study) {
    event.preventDefault();
    byId('deck-search').focus();
  }
  if (event.key === 'Escape' && state.study && !document.querySelector('dialog[open]')) exitStudy();
  if (!state.study || typing) return;
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

byId('login-tab').addEventListener('click', () => switchAuthTab('login'));
byId('register-tab').addEventListener('click', () => switchAuthTab('register'));

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  setBusy(form, true);
  try {
    showApp(await request('/api/auth/login', { method: 'POST', body: values }));
    form.reset();
    toast('Welcome back.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
});

byId('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  setBusy(form, true);
  try {
    showApp(await request('/api/auth/register', { method: 'POST', body: values }));
    form.reset();
    toast('Your learning garden is ready.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
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
      ? await request(`/api/decks/${encodeURIComponent(id)}`, { method: 'PATCH', body: values })
      : await request('/api/decks', { method: 'POST', body: values });
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
    if (id) await request(`/api/cards/${encodeURIComponent(id)}`, { method: 'PATCH', body: values });
    else await request(`/api/decks/${encodeURIComponent(state.currentDeck.id)}/cards`, { method: 'POST', body: values });
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
    const payload = await request('/api/account', { method: 'PATCH', body: { name: byId('profile-name').value } });
    state.user = payload.user;
    updateHeader();
    toast('Profile saved.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(form, false);
  }
});

byId('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  setBusy(form, true);
  try {
    await request('/api/account/password', { method: 'POST', body: values });
    form.reset();
    toast('Password updated.');
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
    await state.confirmAction?.(byId('confirm-password').value);
    byId('confirm-dialog').close();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    state.confirmAction = null;
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

async function init() {
  setTheme(localStorage.getItem('petalcards-theme') || 'pink', { save: false });
  try {
    let payload;
    try {
      payload = await request('/api/bootstrap');
    } catch (error) {
      if (error.status !== 401) throw error;
      payload = await request('/api/guest', { method: 'POST', body: {} });
      // Check that cookies are enabled before allowing any edits.
      await request('/api/bootstrap');
    }
    showApp(payload);
  } catch (error) {
    byId('boot-screen').classList.remove('hidden');
    byId('landing-view').classList.add('hidden');
    byId('app-shell').classList.add('hidden');
    byId('boot-screen').innerHTML = '<p>Could not open your workspace. Check your connection and allow cookies, then try again.</p><button class="button button-primary" type="button" data-action="continue-guest">Try again</button>';
  }
}

init();
