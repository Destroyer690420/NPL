/**
 * Web Audio synthesizer for live auction broadcast cues.
 *
 * Uses pure Web Audio API synthesis (no external MP3 dependencies) so the
 * iconic IPL brass fanfare and player intro cues play reliably offline and
 * with zero network latency on the presenter screen.
 */

let sharedCtx: AudioContext | null = null
let unlocked = false
const listeners = new Set<(ready: boolean) => void>()

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!sharedCtx) {
    sharedCtx = new Ctor()
  }
  return sharedCtx
}

function notifyUnlock(): void {
  for (const listener of listeners) {
    listener(unlocked)
  }
}

export function isAuctionAudioUnlocked(): boolean {
  const ctx = sharedCtx
  return unlocked && ctx?.state === 'running'
}

export function subscribeAuctionAudioState(listener: (ready: boolean) => void): () => void {
  listeners.add(listener)
  listener(isAuctionAudioUnlocked())
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Unlocks / resumes the shared AudioContext during a user gesture (click/keydown).
 */
export async function unlockAuctionAudio(): Promise<boolean> {
  const ctx = getAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    // Play a silent 1-sample buffer to satisfy strict iOS/Chrome autoplay policies
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
    unlocked = ctx.state === 'running'
    notifyUnlock()
    return unlocked
  } catch {
    return false
  }
}

/**
 * Creates a short impulse response buffer for stadium reverb ambience.
 */
function createStadiumReverb(ctx: AudioContext, duration = 1.4, decay = 2.6): ConvolverNode {
  const length = Math.floor(ctx.sampleRate * duration)
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch += 1) {
    const channelData = impulse.getChannelData(ch)
    for (let i = 0; i < length; i += 1) {
      const env = Math.pow(1 - i / length, decay)
      channelData[i] = (Math.random() * 2 - 1) * env
    }
  }
  const convolver = ctx.createConvolver()
  convolver.buffer = impulse
  return convolver
}

/**
 * Synthesizes a single stadium brass horn note (layered detuned sawtooths
 * through a resonant brass filter envelope).
 */
function triggerBrassNote(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  startTime: number,
  duration: number,
  volume = 0.24,
): void {
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.setValueAtTime(2.8, startTime)
  filter.frequency.setValueAtTime(Math.max(400, freq * 1.4), startTime)
  filter.frequency.exponentialRampToValueAtTime(Math.min(7200, freq * 5.2), startTime + 0.045)
  filter.frequency.exponentialRampToValueAtTime(Math.min(4800, freq * 3.1), startTime + duration)

  // Slight pitch scoop on attack for realistic trumpet lip attack
  const osc1 = ctx.createOscillator()
  osc1.type = 'sawtooth'
  osc1.frequency.setValueAtTime(freq * 0.985, startTime)
  osc1.frequency.exponentialRampToValueAtTime(freq, startTime + 0.03)
  osc1.detune.setValueAtTime(-7, startTime)

  const osc2 = ctx.createOscillator()
  osc2.type = 'sawtooth'
  osc2.frequency.setValueAtTime(freq * 0.985, startTime)
  osc2.frequency.exponentialRampToValueAtTime(freq, startTime + 0.03)
  osc2.detune.setValueAtTime(7, startTime)

  const oscSub = ctx.createOscillator()
  oscSub.type = 'triangle'
  oscSub.frequency.setValueAtTime(freq * 0.5, startTime)

  const subGain = ctx.createGain()
  subGain.gain.setValueAtTime(0.32, startTime)

  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.028)
  gain.gain.setValueAtTime(volume * 0.88, Math.max(startTime + 0.04, startTime + duration - 0.06))
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + 0.08)

  osc1.connect(filter)
  osc2.connect(filter)
  oscSub.connect(subGain)
  subGain.connect(filter)
  filter.connect(gain)
  gain.connect(dest)

  osc1.start(startTime)
  osc2.start(startTime)
  oscSub.start(startTime)
  osc1.stop(startTime + duration + 0.12)
  osc2.stop(startTime + duration + 0.12)
  oscSub.stop(startTime + duration + 0.12)
}

/**
 * Synthesizes a punchy timpani / gavel hit.
 */
function triggerDrumHit(ctx: AudioContext, dest: AudioNode, startTime: number, pitch = 110, vol = 0.45): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(pitch * 1.6, startTime)
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, startTime + 0.18)

  gain.gain.setValueAtTime(0.001, startTime)
  gain.gain.linearRampToValueAtTime(vol, startTime + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.28)

  osc.connect(gain)
  gain.connect(dest)
  osc.start(startTime)
  osc.stop(startTime + 0.32)
}

/**
 * Plays the iconic IPL stadium trumpet fanfare + auction hammer hit when a player is SOLD.
 */
export async function playIplSoldTune(): Promise<boolean> {
  const ctx = getAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    if (ctx.state !== 'running') return false
    unlocked = true
    notifyUnlock()

    const now = ctx.currentTime + 0.02

    const master = ctx.createGain()
    master.gain.setValueAtTime(0.85, now)

    const dry = ctx.createGain()
    dry.gain.setValueAtTime(0.78, now)

    const wet = ctx.createGain()
    wet.gain.setValueAtTime(0.32, now)

    const reverb = createStadiumReverb(ctx, 1.5, 2.4)
    dry.connect(master)
    reverb.connect(wet)
    wet.connect(master)
    master.connect(ctx.destination)

    const bus = ctx.createGain()
    bus.connect(dry)
    bus.connect(reverb)

    // 1. Double auction hammer impact + stadium bass hit
    triggerDrumHit(ctx, bus, now, 125, 0.5)
    triggerDrumHit(ctx, bus, now + 0.14, 98, 0.55)

    // 2. Iconic IPL brass trumpet fanfare motif:
    //    Phrase A: E4 - G4 - A4 - C5!  ->  B4 - A4 - G4!
    //    Phrase B: E4 - G4 - A4 - C5 - D5 - E5!! (triumphant stadium hold + octave harmony)
    const notes: Array<[number, number, number, number]> = [
      // [freqHz, offsetSec, durSec, volume]
      // Phrase 1 (energetic rising IPL horn call)
      [329.63, 0.22, 0.13, 0.22], // E4
      [392.0, 0.36, 0.13, 0.23],  // G4
      [440.0, 0.50, 0.14, 0.24],  // A4
      [523.25, 0.65, 0.34, 0.28], // C5
      [493.88, 1.03, 0.14, 0.22], // B4
      [440.0, 1.19, 0.14, 0.22],  // A4
      [392.0, 1.35, 0.38, 0.25],  // G4

      // Phrase 2 (octave jump climax!)
      [523.25, 1.82, 0.13, 0.24], // C5
      [659.25, 1.96, 0.13, 0.25], // E5
      [783.99, 2.10, 0.14, 0.27], // G5
      [1046.5, 2.26, 0.42, 0.31], // C6
      [987.77, 2.72, 0.14, 0.24], // B5
      [880.0, 2.88, 0.14, 0.24],  // A5
      [783.99, 3.04, 0.22, 0.26], // G5
      [880.0, 3.28, 0.16, 0.26],  // A5
      [1046.5, 3.46, 0.95, 0.34], // C6 triumphant finale!
    ]

    for (const [freq, offset, dur, vol] of notes) {
      triggerBrassNote(ctx, bus, freq, now + offset, dur, vol)
    }

    // Harmony chord under the final C6 climax
    triggerDrumHit(ctx, bus, now + 2.26, 110, 0.48)
    triggerDrumHit(ctx, bus, now + 3.46, 130, 0.58)
    triggerBrassNote(ctx, bus, 523.25, now + 3.46, 0.95, 0.22) // C5
    triggerBrassNote(ctx, bus, 659.25, now + 3.46, 0.95, 0.2)  // E5
    triggerBrassNote(ctx, bus, 783.99, now + 3.46, 0.95, 0.2)  // G5

    return true
  } catch {
    return false
  }
}

/**
 * Plays a crisp broadcast swoosh + chime when a new player enters the stage.
 */
export async function playPlayerIntroCue(): Promise<boolean> {
  const ctx = getAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    if (ctx.state !== 'running') return false
    unlocked = true
    notifyUnlock()

    const now = ctx.currentTime + 0.01
    triggerDrumHit(ctx, ctx.destination, now, 140, 0.22)

    const notes = [523.25, 659.25, 783.99] // C5 -> E5 -> G5
    notes.forEach((freq, idx) => {
      const t = now + 0.04 + idx * 0.07
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, t)
      gain.gain.setValueAtTime(0.001, t)
      gain.gain.linearRampToValueAtTime(0.14, t + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.32)
    })

    return true
  } catch {
    return false
  }
}

