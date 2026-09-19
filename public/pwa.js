let installPrompt;
let registration;
let offlineReady = false;
const status = document.getElementById('offline-status');
const installButton = document.getElementById('install-button');
const updateButton = document.getElementById('update-button');
const standalone = matchMedia('(display-mode: standalone)');

function updateStatus() {
  status.textContent = offlineReady
    ? navigator.onLine ? 'Ready for offline use' : 'Offline · cards save on this device'
    : navigator.onLine ? 'Preparing offline use…' : 'Connect once to prepare offline use';
}
function updateInstallButton() {
  installButton.classList.toggle('hidden', standalone.matches || navigator.standalone === true);
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); installPrompt = event; updateInstallButton();
});
window.addEventListener('appinstalled', () => { installPrompt = null; installButton.classList.add('hidden'); });
standalone.addEventListener('change', updateInstallButton);
for (const name of ['online', 'offline']) window.addEventListener(name, updateStatus);

document.addEventListener('click', async (event) => {
  if (!event.target.closest('[data-action="install-app"]')) return;
  if (installPrompt) {
    const prompt = installPrompt; installPrompt = null;
    try { await prompt.prompt(); await prompt.userChoice; } catch { document.getElementById('install-dialog').showModal(); }
  } else document.getElementById('install-dialog').showModal();
});

updateButton.addEventListener('click', () => {
  // Reload only on an explicit action, so a newly deployed version cannot interrupt typing.
  if (registration?.waiting && window.confirm('Update Petalcards now? Saved cards are kept. Finish any unsaved edits before continuing.')) {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  }
});

async function prepareOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    status.textContent = 'Offline installation needs HTTPS and a supported browser';
    return;
  }
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    if (registration.waiting) updateButton.classList.remove('hidden');
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) updateButton.classList.remove('hidden');
        if (worker.state === 'redundant' && !offlineReady) status.textContent = 'Offline setup failed · reconnect and refresh to retry';
      });
    });
    await navigator.serviceWorker.ready;
    offlineReady = true;
    updateStatus();
  } catch {
    status.textContent = 'Offline setup failed · reconnect and refresh to retry';
  }
}
updateInstallButton();
updateStatus();
prepareOffline();
