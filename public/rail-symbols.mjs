import { operatorTags } from './train-label.mjs';

// Hemel diagram units. Native packages round these dimensions at their panel scale.
export const trainWidth = 50, trainHeight = 21;
export const signalRadius = (small) => small ? 2.7 : 5.3;

export function drawSignalLamp(shape, group, x, y, small) {
  return shape(group, 'circle', {
    cx: x, cy: y, r: signalRadius(small), 'stroke-width': small ? 1.2 : 2, class: 'lamp',
  });
}

export function showSignalAspect(lamp, indication) {
  const ink = indication === 'on' ? 'var(--signal-on)'
    : indication === 'off' ? 'var(--signal-off)' : 'var(--signal-unknown)';
  lamp.setAttribute('fill', indication === 'on' ? ink : 'var(--board)');
  lamp.setAttribute('stroke', ink);
  lamp.setAttribute('stroke-dasharray', indication === 'on' || indication === 'off' ? '' : '2 2');
}

export function drawHeadcode(shape, group, x, y, width, selected = false) {
  const badge = shape(group, 'rect', {
    x: x - width / 2, y: y - trainHeight / 2, width, height: trainHeight, rx: 3,
    stroke: selected ? 'var(--marker-focus)' : 'none', 'stroke-width': 2, class: 'ring',
  });
  const label = shape(group, 'text', {
    x, y, 'dominant-baseline': 'central', 'text-anchor': 'middle', fill: 'var(--train-text)',
    'font-size': Math.min(13, width / 2.85), 'font-weight': 700,
  });
  return { badge, label, group, shape, x, y, width };
}

const cssColour = (rgb) => '#' + rgb.toString(16).padStart(6, '0');

export function showHeadcode(symbol, headcode, kind, friendly = '') {
  const { badge, label, group, shape, x, y, width } = symbol;
  const inks = ['transparent', 'var(--train-fill)', 'var(--other-description)', 'var(--stale-description)'];
  badge.setAttribute('fill', inks[kind]);
  const text = friendly.slice(0, 3) || headcode;
  const operator = width >= 30 && friendly.slice(3);
  const tagWidth = operator ? Math.round(width * 0.36) : 0;
  label.setAttribute('x', x + tagWidth / 2);
  label.setAttribute('font-size', Math.min(13, (width - tagWidth) / (friendly ? 2.25 : 2.85)));
  if (label.textContent !== text) label.textContent = text;
  if (!operator) {
    if (symbol.tag) symbol.tag.style.display = 'none';
    return;
  }
  const [name, background, foreground] = operatorTags[operator] || [operator, 0x374247, 0xf4f5f6];
  if (!symbol.tag) {
    const left = x - width / 2 + 1;
    symbol.tag = shape(group, 'g', {class: 'operator-tag', 'pointer-events': 'none'});
    symbol.block = shape(symbol.tag, 'rect', {x:left, y:y - 9.5, width:tagWidth, height:19, rx:2});
    symbol.caption = shape(symbol.tag, 'text', {x:left + tagWidth / 2, y,
      'text-anchor':'middle', 'dominant-baseline':'central', 'font-weight':700});
  }
  symbol.tag.style.display = '';
  symbol.block.setAttribute('fill', cssColour(background));
  symbol.caption.setAttribute('fill', cssColour(foreground));
  symbol.caption.setAttribute('font-size', Math.min(10, (tagWidth - 1) / (name.length * 0.68)));
  symbol.caption.textContent = name;
}
