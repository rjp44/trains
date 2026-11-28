// Run against a built site with Playwright available to Node.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

async function checkHemel(page) {
  await page.locator('#open-settings').click();
  await page.locator('#replay').click();
  await page.waitForFunction(() => !document.querySelector('#replaybar').hidden);
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await page.locator('.settings-done').click();
  return page.evaluate(() => {
    const map = document.querySelector('#map');
    const background = map.querySelector('[data-layer=infrastructure]');
    const trains = map.querySelector('[data-layer=trains]');
    const signals = map.querySelector('[data-layer=signals]');
    const camera = () => [map.getAttribute('viewBox'), background.parentNode.getAttribute('transform')].join('/');
    const initial = camera(), observer = new MutationObserver(() => {});
    observer.observe(background, {subtree: true, attributes: true, childList: true, characterData: true});
    const occupancies = new Set(), aspects = new Set(), scrub = document.querySelector('#scrub');
    for (let i = 0; i <= 36; i++) {
      scrub.value = Number(scrub.max) * i / 36;
      scrub.dispatchEvent(new Event('input', {bubbles: true}));
      if (!background.isConnected || camera() !== initial) throw Error('Hemel camera changed during replay');
      occupancies.add([...trains.children].map(g => g.dataset.key + g.textContent).join('/'));
      aspects.add([...signals.querySelectorAll('.lamp')].map(lamp => lamp.getAttribute('fill')).join('/'));
    }
    return occupancies.size > 1 && aspects.size > 1 && observer.takeRecords().length === 0;
  });
}

async function checkRegional(page) {
  await page.locator('#tracks .map-label').first().waitFor({state: 'attached'});
  return page.evaluate(async () => {
    const {id, json} = transportApp;
    const [layout, tables, {lineBoard}] = await Promise.all([
      json('data/corridor.json'), json('native/tables.json'), import('./line-board.mjs'),
    ]);
    const old = document.querySelector('#tracks'), el = old.cloneNode(false);
    old.replaceWith(el);
    const board = lineBoard(el, layout, tables, id, () => {});
    const empty = tables.markerInfo.map(() => [0, 0, '', '', '', '', '']);
    for (let view = 0; view < 3; view++) {
      board.paint(view);
      board.update(empty, false, '', '');
      el.scrollLeft = 333;
      const background = el.querySelector('[data-layer=infrastructure]');
      const map = background.ownerSVGElement, observer = new MutationObserver(() => {});
      observer.observe(background, {subtree: true, attributes: true, childList: true, characterData: true});
      const camera = () => [map.getAttribute('viewBox'), el.scrollLeft, el.scrollWidth].join('/');
      const initial = camera(), rows = empty.slice();
      let previous;
      for (const berth of map.querySelectorAll('[data-berth]')) {
        if (previous !== undefined) rows[previous] = empty[previous];
        const index = tables.markerInfo.findIndex(m => m[0] === berth.dataset.berth);
        rows[index] = [2, 1, '1A42', '', '', '', 'EUSVT'];
        board.update(rows, true, '', berth.dataset.berth);
        if (!berth.classList.contains('followed') || !berth.textContent.includes('EUS')) return false;
        if (!background.isConnected || camera() !== initial) return false;
        previous = index;
      }
      board.update(empty, false, '', '');
      if (map.querySelector('.berth.head') || observer.takeRecords().length) return false;
    }
    return true;
  });
}

(async () => {
  const base = process.argv[2];
  if (!base) throw Error('Pass the URL of the built site');
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN});
  try {
    for (const id of ['hemel', 'crewe-birmingham', 'preston-crewe']) {
      const page = await browser.newPage({viewport: {width: 1024, height: 600}, serviceWorkers: 'block'});
      await page.goto(new URL('/apps/' + id + '/', base).href, {waitUntil: 'domcontentloaded'});
      assert(await (id === 'hemel' ? checkHemel(page) : checkRegional(page)), id + ' overlay regression');
      console.log(id + ' preserves its diagram during train movements');
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
