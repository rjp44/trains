const $ = (id) => document.getElementById(id);
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MiB' : (n / 1024).toFixed(1) + ' KiB');
try {
  const res = await fetch('/directory.json');
  if (!res.ok) throw Error();
  const { applications, firmware } = await res.json();
  function render() {
    const q = $('search').value.trim().toLowerCase();
    const rows = applications.filter((a) =>
      (a.id + ' ' + a.name + ' ' + a.description).toLowerCase().includes(q),
    );
    $('count').textContent = rows.length + ' ' + (rows.length === 1 ? 'application' : 'applications');
    $('apps').replaceChildren(
      ...rows.map((a) => {
        const card = $('card').content.cloneNode(true);
        card.querySelector('h2').textContent = a.name;
        card.querySelector('p').textContent = a.description;
        card.querySelector('small').textContent =
          'v' + a.version + ' · ' + size(a.bytes) + ' download · ' + size(a.storageBytes) + ' on tablet';
        const [open, download] = card.querySelectorAll('a');
        open.href = a.app;
        download.href = a.download;
        download.download = a.id + '-v' + a.version + '.tda';
        return card;
      }),
    );
  }
  $('search').addEventListener('input', render);
  render();
  if (firmware) {
    $('firmware').hidden = false;
    $('image').href = firmware.download;
    $('image').textContent = 'Download core v' + firmware.version + ' · ' + size(firmware.bytes);
  }
} catch {
  $('count').textContent = 'The application directory could not be loaded. Reload to try again.';
}
