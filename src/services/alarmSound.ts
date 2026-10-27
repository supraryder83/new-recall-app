/**
 * Emergency Safety Recall Alarm Sound Service
 * Uses the Web Audio API to synthesize a high-urgency Canadian safety alarm siren.
 * Requires no external audio files, works offline, and handles browser autoplay policies.
 */

let audioCtx: AudioContext | null = null;
let sirenOsc1: OscillatorNode | null = null;
let sirenOsc2: OscillatorNode | null = null;
let sirenGain: GainNode | null = null;
let sirenInterval: any = null;
let isPlaying = false;
let pendingUnlock = false;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

/**
 * Start the emergency recall siren
 */
export async function playRecallAlarmSound(loopDurationSeconds: number = 12): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const ctx = getAudioContext();

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay policy prevented immediate playback
      }
    }

    // If still suspended due to browser autoplay restriction, set up a one-time gesture unlock
    if (ctx.state === 'suspended') {
      if (!pendingUnlock) {
        pendingUnlock = true;
        const unlock = async () => {
          try {
            await ctx.resume();
            if (ctx.state === 'running') {
              startSynthesizedSiren(ctx, loopDurationSeconds);
            }
          } catch {}
          window.removeEventListener('click', unlock);
          window.removeEventListener('touchstart', unlock);
          window.removeEventListener('keydown', unlock);
          pendingUnlock = false;
        };
        window.addEventListener('click', unlock, { once: true });
        window.addEventListener('touchstart', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
      }
      return false;
    }

    startSynthesizedSiren(ctx, loopDurationSeconds);
    return true;
  } catch (err) {
    console.warn('[AlarmSound] Web Audio error:', err);
    return false;
  }
}

function startSynthesizedSiren(ctx: AudioContext, loopDurationSeconds: number): void {
  // Stop existing sound if running
  stopRecallAlarmSound();

  try {
    isPlaying = true;
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.35, now + 0.05);
    masterGain.connect(ctx.destination);
    sirenGain = masterGain;

    // Dual-tone alternating siren (960Hz / 770Hz) for emergency safety alert
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();

    osc1.type = 'sawtooth';
    osc2.type = 'sine';

    osc1.frequency.setValueAtTime(960, now);
    osc2.frequency.setValueAtTime(480, now);

    osc1.connect(masterGain);
    osc2.connect(masterGain);

    osc1.start(now);
    osc2.start(now);

    sirenOsc1 = osc1;
    sirenOsc2 = osc2;

    // Modulate frequency back and forth every 350ms for urgent siren pattern
    let toggle = false;
    sirenInterval = setInterval(() => {
      if (!audioCtx || audioCtx.state !== 'running' || !sirenOsc1) {
        stopRecallAlarmSound();
        return;
      }
      toggle = !toggle;
      const t = audioCtx.currentTime;
      try {
        if (sirenOsc1 && sirenOsc2) {
          sirenOsc1.frequency.cancelScheduledValues(t);
          sirenOsc2.frequency.cancelScheduledValues(t);

          if (toggle) {
            sirenOsc1.frequency.linearRampToValueAtTime(770, t + 0.1);
            sirenOsc2.frequency.linearRampToValueAtTime(385, t + 0.1);
          } else {
            sirenOsc1.frequency.linearRampToValueAtTime(960, t + 0.1);
            sirenOsc2.frequency.linearRampToValueAtTime(480, t + 0.1);
          }
        }
      } catch {}
    }, 350);

    // Auto-stop after specified duration to avoid annoyance
    if (loopDurationSeconds > 0) {
      setTimeout(() => {
        stopRecallAlarmSound();
      }, loopDurationSeconds * 1000);
    }

    // Dispatch global event so UI knows alarm is active
    window.dispatchEvent(new CustomEvent('recall-alarm-playing-changed', { detail: { isPlaying: true } }));
  } catch (err) {
    console.warn('[AlarmSound] Failed to synthesize siren:', err);
    isPlaying = false;
  }
}

/**
 * Stop any currently sounding alarm
 */
export function stopRecallAlarmSound(): void {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }

  if (sirenGain && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      sirenGain.gain.cancelScheduledValues(now);
      sirenGain.gain.setValueAtTime(sirenGain.gain.value, now);
      sirenGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch {}
  }

  setTimeout(() => {
    if (sirenOsc1) {
      try {
        sirenOsc1.stop();
        sirenOsc1.disconnect();
      } catch {}
      sirenOsc1 = null;
    }
    if (sirenOsc2) {
      try {
        sirenOsc2.stop();
        sirenOsc2.disconnect();
      } catch {}
      sirenOsc2 = null;
    }
    if (sirenGain) {
      try {
        sirenGain.disconnect();
      } catch {}
      sirenGain = null;
    }
  }, 100);

  isPlaying = false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('recall-alarm-playing-changed', { detail: { isPlaying: false } }));
  }
}

/**
 * Check if the alarm is currently sounding
 */
export function isAlarmSoundPlaying(): boolean {
  return isPlaying;
}
