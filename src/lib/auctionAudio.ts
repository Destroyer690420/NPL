/**
 * Audio playback controller for live auction broadcast cues.
 *
 * Manages:
 * - Sold celebration fanfare (`/audio/ipl-sold.mp3`) looped during SOLD displays.
 * - Stage ambient music (`/audio/stage-ambient.mp3`) looped during Start Timer & Break screens.
 * - Short WebAudio chime when a new player enters spotlight.
 */

const SOLD_CLIP_URL = '/audio/ipl-sold.mp3'
const STAGE_AMBIENT_URL = '/audio/stage-ambient.mp3'

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

class LoopingAudioTrack {
  private readonly url: string
  private readonly gainValue: number
  private buffer: AudioBuffer | null = null
  private bufferPromise: Promise<AudioBuffer | null> | null = null
  private activeSource: AudioBufferSourceNode | null = null
  private fallbackAudio: HTMLAudioElement | null = null
  private playSeq = 0

  constructor(url: string, gainValue = 0.95) {
    this.url = url
    this.gainValue = gainValue
  }

  private getFallbackAudio(): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
    if (!this.fallbackAudio) {
      this.fallbackAudio = new Audio(this.url)
      this.fallbackAudio.preload = 'auto'
    }
    return this.fallbackAudio
  }

  preload(ctx: AudioContext): Promise<AudioBuffer | null> {
    if (this.buffer) return Promise.resolve(this.buffer)
    if (!this.bufferPromise) {
      this.bufferPromise = fetch(this.url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.arrayBuffer()
        })
        .then((arr) => ctx.decodeAudioData(arr))
        .then((decoded) => {
          this.buffer = decoded
          return decoded
        })
        .catch(() => {
          this.bufferPromise = null
          return null
        })
    }
    return this.bufferPromise
  }

  prepareFallback(): void {
    this.getFallbackAudio()
  }

  isPlaying(): boolean {
    if (this.activeSource) return true
    return Boolean(this.fallbackAudio && !this.fallbackAudio.paused)
  }

  private stopNodesOnly(): void {
    if (this.activeSource) {
      try {
        this.activeSource.stop()
      } catch {
        // Ignore already-stopped source
      }
      this.activeSource.disconnect()
      this.activeSource = null
    }
    if (this.fallbackAudio) {
      try {
        this.fallbackAudio.pause()
        this.fallbackAudio.currentTime = 0
      } catch {
        // Ignore
      }
    }
  }

  stop(): void {
    this.playSeq += 1
    this.stopNodesOnly()
  }

  async play(options?: { restart?: boolean }): Promise<boolean> {
    if (!options?.restart && this.isPlaying()) {
      return true
    }

    const seq = ++this.playSeq
    this.stopNodesOnly()

    const ctx = getAudioContext()
    if (ctx) {
      try {
        if (ctx.state === 'suspended' && unlocked) {
          await ctx.resume()
        }
        if (seq !== this.playSeq) return false

        if (ctx.state === 'running') {
          unlocked = true
          notifyUnlock()

          const buffer = await this.preload(ctx)
          if (seq !== this.playSeq) return false

          if (buffer) {
            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.loop = true
            const gain = ctx.createGain()
            gain.gain.setValueAtTime(this.gainValue, ctx.currentTime)
            source.connect(gain)
            gain.connect(ctx.destination)
            source.onended = () => {
              if (this.activeSource === source) this.activeSource = null
            }
            this.activeSource = source
            source.start(0)
            return true
          }
        }
      } catch {
        // Fall through to HTMLAudio fallback
      }
    }

    if (seq !== this.playSeq) return false

    const el = this.getFallbackAudio()
    if (!el) return false
    try {
      el.pause()
      el.currentTime = 0
      el.loop = true
      el.volume = Math.min(1, Math.max(0, this.gainValue))
      await el.play()
      if (seq !== this.playSeq) {
        el.pause()
        el.currentTime = 0
        return false
      }
      unlocked = true
      notifyUnlock()
      return true
    } catch {
      return false
    }
  }
}

const soldTrack = new LoopingAudioTrack(SOLD_CLIP_URL, 0.95)
const stageAmbientTrack = new LoopingAudioTrack(STAGE_AMBIENT_URL, 0.85)

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
 * Stops any currently looping SOLD music immediately.
 */
export function stopIplSoldTune(): void {
  soldTrack.stop()
}

/**
 * Stops the Start Timer / Break Screen ambient music immediately.
 */
export function stopStageAmbientMusic(): void {
  stageAmbientTrack.stop()
}

/**
 * Unlocks / resumes the shared AudioContext during a user gesture (click/keydown)
 * and preloads broadcast audio tracks so cues play cleanly.
 */
export async function unlockAuctionAudio(): Promise<boolean> {
  const ctx = getAudioContext()
  soldTrack.prepareFallback()
  stageAmbientTrack.prepareFallback()
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
      void soldTrack.preload(ctx)
      void stageAmbientTrack.preload(ctx)
    }
    return unlocked
  } catch {
    return false
  }
}

/**
 * Plays the IPL fanfare clip in a continuous loop until `stopIplSoldTune()` is called.
 */
export async function playIplSoldTune(): Promise<boolean> {
  stageAmbientTrack.stop()
  return soldTrack.play({ restart: true })
}

/**
 * Plays the Start Timer / Break Screen music in a continuous loop until `stopStageAmbientMusic()` is called.
 */
export async function playStageAmbientMusic(): Promise<boolean> {
  soldTrack.stop()
  return stageAmbientTrack.play({ restart: false })
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
