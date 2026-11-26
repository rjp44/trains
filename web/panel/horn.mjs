import { readSetting, saveSetting } from './appearance.mjs';
export function trainSound() {
  let context,
    next = 0;
  let mode = readSetting('sound', 'off'),
    volume = readSetting('volume', 70);
  function unlock() {
    if (mode === 'off') return;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === 'suspended') context.resume().catch(() => {});
  }
  document.addEventListener('click', unlock);
  return {
    get mode() {
      return mode;
    },
    get volume() {
      return volume;
    },
    select(value) {
      mode = value;
      saveSetting('sound', mode);
      unlock();
    },
    level(value) {
      volume = value;
      saveSetting('volume', volume);
    },
    play(down, stops) {
      if (
        document.hidden ||
        !context ||
        context.state !== 'running' ||
        mode === 'off' ||
        (mode === 'stops' && !stops) ||
        context.currentTime < next
      )
        return;
      const at = context.currentTime;
      next = at + 1.6;
      for (const [delay, freq, duration, pan] of [
        [0, 554, 0.65, down ? -1 : 1],
        [0.79, 370, 0.8, down ? 1 : -1],
      ]) {
        const tone = context.createOscillator(),
          gain = context.createGain(),
          t = at + delay;
        tone.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime((0.09 * volume) / 100, t + 0.012);
        gain.gain.setValueAtTime((0.09 * volume) / 100, t + duration - 0.012);
        gain.gain.linearRampToValueAtTime(0, t + duration);
        tone.connect(gain);
        if (context.createStereoPanner) {
          const channel = context.createStereoPanner();
          channel.pan.value = pan;
          gain.connect(channel).connect(context.destination);
        } else gain.connect(context.destination);
        tone.start(t);
        tone.stop(t + duration);
      }
    },
  };
}
