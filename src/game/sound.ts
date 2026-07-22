export type GameSoundKind =
  | "accepted"
  | "placed"
  | "rejected"
  | "timerExpired"
  | "timerTick"
  | "timerWarning";
export type SoundPalette = "arcade" | "tactile";

export const SOUND_PALETTES: Array<{
  id: SoundPalette;
  label: string;
  description: string;
}> = [
  { id: "tactile", label: "Плочице", description: "Мекан, физички клик и топла потврда." },
  { id: "arcade", label: "Аркада", description: "Разигран, брз и мало израженији." },
];

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedContext: AudioContext | null = null;

function getAudioContext() {
  const audioWindow = window as AudioWindow;
  const AudioContextClass = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextClass) return null;
  sharedContext ??= new AudioContextClass();
  return sharedContext;
}

function tone(
  context: AudioContext,
  options: {
    duration: number;
    frequency: number;
    offset?: number;
    slideTo?: number;
    type?: OscillatorType;
    volume: number;
  },
) {
  const start = context.currentTime + (options.offset ?? 0);
  const stop = start + options.duration;
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  oscillator.type = options.type ?? "sine";
  oscillator.frequency.setValueAtTime(options.frequency, start);
  if (options.slideTo) oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, stop);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(options.type === "square" ? 2600 : 5200, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.volume, start + Math.min(0.012, options.duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, stop);
  oscillator.connect(filter).connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(stop);
}

function tap(context: AudioContext, offset = 0, volume = 0.035, frequency = 1700) {
  const duration = 0.045;
  const sampleCount = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = 1 - index / sampleCount;
    data[index] = (Math.random() * 2 - 1) * envelope * envelope;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const start = context.currentTime + offset;
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(frequency, start);
  filter.Q.setValueAtTime(0.8, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
}

const soundPatterns: Record<SoundPalette, Record<GameSoundKind, (context: AudioContext) => void>> = {
  tactile: {
    placed(context) {
      tap(context, 0, 0.042, 1450);
      tone(context, { duration: 0.075, frequency: 205, slideTo: 150, type: "sine", volume: 0.045 });
    },
    accepted(context) {
      [0, 0.065, 0.13].forEach((offset, index) => {
        tap(context, offset, 0.044 - index * 0.004, 980 - index * 90);
        tone(context, {
          duration: 0.095,
          frequency: 185 - index * 12,
          offset,
          slideTo: 118 - index * 8,
          type: "sine",
          volume: 0.056,
        });
      });
      tone(context, { duration: 0.2, frequency: 112, offset: 0.135, slideTo: 72, volume: 0.046 });
    },
    rejected(context) {
      tap(context, 0, 0.04, 520);
      tone(context, { duration: 0.16, frequency: 210, slideTo: 125, type: "triangle", volume: 0.055 });
      tone(context, { duration: 0.13, frequency: 145, offset: 0.105, slideTo: 105, type: "sine", volume: 0.04 });
    },
    timerWarning(context) {
      tap(context, 0, 0.026, 620);
      tone(context, { duration: 0.12, frequency: 160, slideTo: 108, type: "sine", volume: 0.045 });
      tone(context, { duration: 0.12, frequency: 142, offset: 0.14, slideTo: 94, type: "sine", volume: 0.04 });
    },
    timerTick(context) {
      tap(context, 0, 0.023, 540);
      tone(context, { duration: 0.075, frequency: 138, slideTo: 96, type: "sine", volume: 0.038 });
    },
    timerExpired(context) {
      tap(context, 0, 0.035, 360);
      tone(context, { duration: 0.3, frequency: 132, slideTo: 54, type: "triangle", volume: 0.06 });
      tone(context, { duration: 0.18, frequency: 82, offset: 0.1, slideTo: 48, type: "sine", volume: 0.045 });
    },
  },
  arcade: {
    placed(context) {
      tone(context, { duration: 0.065, frequency: 280, slideTo: 390, type: "square", volume: 0.032 });
    },
    accepted(context) {
      [420, 560, 720, 960].forEach((frequency, index) => {
        tone(context, { duration: 0.085, frequency, offset: index * 0.055, slideTo: frequency * 1.08, type: "square", volume: 0.027 });
      });
    },
    rejected(context) {
      tone(context, { duration: 0.2, frequency: 260, slideTo: 105, type: "sawtooth", volume: 0.034 });
      tap(context, 0.1, 0.025, 420);
    },
    timerWarning(context) {
      tone(context, { duration: 0.09, frequency: 330, slideTo: 270, type: "square", volume: 0.025 });
      tone(context, { duration: 0.09, frequency: 300, offset: 0.13, slideTo: 235, type: "square", volume: 0.023 });
    },
    timerTick(context) {
      tone(context, { duration: 0.055, frequency: 260, slideTo: 205, type: "square", volume: 0.022 });
    },
    timerExpired(context) {
      tone(context, { duration: 0.26, frequency: 240, slideTo: 72, type: "sawtooth", volume: 0.035 });
      tap(context, 0.08, 0.026, 320);
    },
  },
};

export async function unlockGameAudio() {
  const context = getAudioContext();
  if (context?.state === "suspended") await context.resume();
}

export async function playGameSound(kind: GameSoundKind, palette: SoundPalette) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") await context.resume();
  soundPatterns[palette][kind](context);
}
