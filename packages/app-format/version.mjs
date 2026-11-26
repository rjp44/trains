// Older tablet firmware compares signed integers and checks the decimal ESP-IDF image version.
export function versionCode(name) {
  if (typeof name !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.test(name))
    throw Error('Expected a release version such as 0.9.0');
  const [major, minor, patch] = name.split('.').map(Number);
  const code = major * 1_000_000 + minor * 1000 + patch;
  if (code < 9000 || code > 0x7ffffffe) throw Error('Release version outside the OTA range');
  return code;
}

export function versionName(code) {
  if (!Number.isSafeInteger(code) || code < 1 || code > 0x7ffffffe) throw Error('Invalid OTA version');
  if (code < 9000) return null;
  return [Math.floor(code / 1_000_000), Math.floor(code / 1000) % 1000, code % 1000].join('.');
}
