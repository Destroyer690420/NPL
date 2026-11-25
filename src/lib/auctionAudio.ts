/**
 * Audio playback controller for live auction broadcast cues.
 *
 * Uses the trimmed 4-second IPL fanfare clip (`/audio/ipl-sold.mp3`) for SOLD
 * celebrations, decoded into the shared Web Audio context (with HTMLAudio
 * fallback) so playback starts instantaneously once the presenter unlocks audio.
 */

const SOLD_CLIP_URL = '/audio/ipl-sold.mp3'

let sharedCtx: AudioContext | null = null
let unlocked = false
let soldBuffer: AudioBuffer | null = null
let soldBufferPromise: Promise<AudioBuffer | null> | null = null
let activeSource: AudioBufferSourceNode | null = null
let fallbackAudio: HTMLAudioElement | null = null
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

function getFallbackAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (!fallbackAudio) {
    fallbackAudio = new Audio(SOLD_CLIP_URL)
    fallbackAudio.preload = 'auto'
  }
  return fallbackAudio
}

async function loadSoldBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (soldBuffer) return soldBuffer
  if (!soldBufferPromise) {
    soldBufferPromise = fetch(SOLD_CLIP_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((arr) => ctx.decodeAudioData(arr))
      .then((decoded) => {
        soldBuffer = decoded
        return decoded
      })
      .catch(() => null)
  }
  return soldBufferPromise
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
 * Unlocks / resumes the shared AudioContext during a user gesture (click/keydown)
 * and preloads the 4-second IPL sold clip so future sales play with zero lag.
 */
export async function unlockAuctionAudio(): Promise<boolean> {
  const ctx = getAudioContext()
  getFallbackAudio()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
    unlocked = ctx.state === 'running'
    notifyUnlock()
    if (unlocked) {
      void loadSoldBuffer(ctx)
    }
    return unlocked
  } catch {
    return false
  }
}

/**
 * Plays the first 4 seconds of the uploaded IPL fanfare clip when a player is SOLD.
 */
export async function playIplSoldTune(): Promise<boolean> {
  const ctx = getAudioContext()
  if (ctx) {
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      if (ctx.state === 'running') {
        unlocked = true
        notifyUnlock()

        const buffer = await loadSoldBuffer(ctx)
        if (buffer) {
          if (activeSource) {
            try {
              activeSource.stop()
            } catch {
              // Ignore already-stopped source
            }
            activeSource = null
          }
          const source = ctx.createBufferSource()
          source.buffer = buffer
          const gain = ctx.createGain()
          gain.gain.setValueAtTime(0.95, ctx.currentTime)
          source.connect(gain)
          gain.connect(ctx.destination)
          source.onended = () => {
            if (activeSource === source) activeSource = null
          }
          activeSource = source
          source.start(0)
          return true
        }
      }
    } catch {
      // Fall through to HTMLAudio fallback
    }
  }

  const el = getFallbackAudio()
  if (!el) return false
  try {
    el.pause()
    el.currentTime = 0
    await el.play()
    unlocked = true
    notifyUnlock()
    return true
  } catch {
    return false
  }
}

/**
 * Plays a crisp broadcast chime when a new player enters the stage.
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
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((freq, idx) => {
      const t = now + 0.03 + idx * 0.07
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
