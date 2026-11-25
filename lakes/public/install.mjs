const help = document.getElementById('install-help');
const button = document.getElementById('install');
const installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
let prompt;
function update() {
  help.hidden = installed.matches || navigator.standalone === true;
  button.hidden = !prompt;
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  prompt = event;
  update();
});
button.onclick = async () => {
  if (!prompt) return;
  const event = prompt;
  prompt = null;
  update();
  await event.prompt();
};
window.addEventListener('appinstalled', () => {
  prompt = null;
  help.hidden = true;
});
installed.addEventListener('change', update);
update();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .catch((error) => console.warn('Offline map unavailable', error.message));
}
