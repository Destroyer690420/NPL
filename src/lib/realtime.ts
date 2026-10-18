import { getSupabase } from './supabase'
import type { AuctionBreak, AuctionCountdown, SoldPlayerAnnouncement, SpotlightPlayer } from '@shared/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

export interface SpotlightBroadcastPayload {
  eventId: string
  spotlightPlayer: SpotlightPlayer | null
}

export interface CountdownBroadcastPayload {
  eventId: string
  countdown: AuctionCountdown | null
}

export interface BreakBroadcastPayload {
  eventId: string
  break: AuctionBreak | null
}

const activeChannels = new Map<string, RealtimeChannel>()

/**
 * Initializes and joins the Supabase Realtime channel for an auction event.
 * Listens for broadcast and postgres changes, dispatching local DOM events
 * so all active components and hooks update instantaneously without page reloads.
 */
export function subscribeToAuctionRealtime(eventId: string): () => void {
  const supabase = getSupabase()
  if (!supabase || !eventId) return () => {}

  const topic = `auction-spotlight:${eventId}`
  let channel = activeChannels.get(topic)

  if (!channel) {
    channel = supabase.channel(topic, {
      config: {
        broadcast: { self: true },
      },
    })

    // Listen for WebSocket broadcast messages (instant <50ms push)
    channel.on(
      'broadcast',
      { event: 'spotlight_change' },
      ({ payload }: { payload: SpotlightBroadcastPayload }) => {
        if (payload?.eventId === eventId) {
          window.dispatchEvent(
            new CustomEvent('auction:spotlight_change', {
              detail: payload,
            }),
          )
        }
      },
    )

    // Listen for Player Sold celebrations across all connected screens
    channel.on(
      'broadcast',
      { event: 'player_sold' },
      ({ payload }: { payload: SoldPlayerAnnouncement }) => {
        if (!payload?.eventId || payload.eventId === eventId) {
          window.dispatchEvent(
            new CustomEvent('auction:player_sold', {
              detail: payload,
            }),
          )
        }
      },
    )

    // Listen for Auction Starting Countdown broadcasts
    channel.on(
      'broadcast',
      { event: 'countdown_change' },
      ({ payload }: { payload: CountdownBroadcastPayload }) => {
        if (payload?.eventId === eventId) {
          window.dispatchEvent(
            new CustomEvent('auction:countdown_change', {
              detail: payload,
            }),
          )
        }
      },
    )

    // Listen for Auction Break / Intermission broadcasts
    channel.on(
      'broadcast',
      { event: 'break_change' },
      ({ payload }: { payload: BreakBroadcastPayload }) => {
        if (payload?.eventId === eventId) {
          window.dispatchEvent(
            new CustomEvent('auction:break_change', {
              detail: payload,
            }),
          )
        }
      },
    )

    // Also listen for Postgres table updates as a fallback
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'events',
        filter: `id=eq.${eventId}`,
      },
      (payload) => {
        const newData = (
          payload.new as {
            data?: {
              spotlightPlayer?: SpotlightPlayer | null
              lastSoldPlayer?: SoldPlayerAnnouncement | null
              countdown?: AuctionCountdown | null
              break?: AuctionBreak | null
            }
          }
        )?.data

        if (newData) {
          if ('spotlightPlayer' in newData) {
            window.dispatchEvent(
              new CustomEvent('auction:spotlight_change', {
                detail: {
                  eventId,
                  spotlightPlayer: newData.spotlightPlayer ?? null,
                },
              }),
            )
          }
          if (newData.lastSoldPlayer) {
            window.dispatchEvent(
              new CustomEvent('auction:player_sold', {
                detail: newData.lastSoldPlayer,
              }),
            )
          }
          if ('countdown' in newData) {
            window.dispatchEvent(
              new CustomEvent('auction:countdown_change', {
                detail: {
                  eventId,
                  countdown: newData.countdown ?? null,
                },
              }),
            )
          }
          if ('break' in newData) {
            window.dispatchEvent(
              new CustomEvent('auction:break_change', {
                detail: {
                  eventId,
                  break: newData.break ?? null,
                },
              }),
            )
          }
        }
      },
    )

    channel.subscribe()
    activeChannels.set(topic, channel)
  }

  return () => {
    // Keep channel cached for active session
  }
}

/**
 * Broadcasts a live auction spotlight update to all connected team and admin screens.
 */
export function broadcastSpotlight(eventId: string, spotlightPlayer: SpotlightPlayer | null): void {
  if (!eventId) return

  // 1. Dispatch locally so the sender window updates synchronously in 0ms
  window.dispatchEvent(
    new CustomEvent('auction:spotlight_change', {
      detail: { eventId, spotlightPlayer },
    }),
  )

  // 2. Broadcast via Supabase Realtime WebSocket to all connected devices
  try {
    const supabase = getSupabase()
    if (!supabase) return

    const topic = `auction-spotlight:${eventId}`
    let channel = activeChannels.get(topic)
    if (!channel) {
      channel = supabase.channel(topic, {
        config: { broadcast: { self: true } },
      })
      channel.subscribe()
      activeChannels.set(topic, channel)
    }

    void channel.send({
      type: 'broadcast',
      event: 'spotlight_change',
      payload: { eventId, spotlightPlayer },
    })
  } catch (err) {
    console.warn('[realtime] broadcast error:', err)
  }
}

/**
 * Broadcasts a player sold celebration announcement to all connected team and admin screens.
 */
export function broadcastPlayerSold(eventId: string, announcement: SoldPlayerAnnouncement): void {
  if (!eventId || !announcement) return

  const payload: SoldPlayerAnnouncement = {
    ...announcement,
    eventId,
    soldAt: announcement.soldAt ?? new Date().toISOString(),
  }

  // 1. Dispatch locally so the sender window updates synchronously in 0ms
  window.dispatchEvent(
    new CustomEvent('auction:player_sold', {
      detail: payload,
    }),
  )

  // 2. Broadcast via Supabase Realtime WebSocket to all connected devices
  try {
    const supabase = getSupabase()
    if (!supabase) return

    const topic = `auction-spotlight:${eventId}`
    let channel = activeChannels.get(topic)
    if (!channel) {
      channel = supabase.channel(topic, {
        config: { broadcast: { self: true } },
      })
      channel.subscribe()
      activeChannels.set(topic, channel)
    }

    void channel.send({
      type: 'broadcast',
      event: 'player_sold',
      payload,
    })
  } catch (err) {
    console.warn('[realtime] broadcast player_sold error:', err)
  }
}

/**
 * Broadcasts an auction starting countdown update to all connected team and admin screens.
 */
export function broadcastCountdown(eventId: string, countdown: AuctionCountdown | null): void {
  if (!eventId) return

  const payload: CountdownBroadcastPayload = {
    eventId,
    countdown,
  }

  // 1. Dispatch locally in 0ms
  window.dispatchEvent(
    new CustomEvent('auction:countdown_change', {
      detail: payload,
    }),
  )

  // 2. Broadcast via Supabase Realtime WebSocket
  try {
    const supabase = getSupabase()
    if (!supabase) return

    const topic = `auction-spotlight:${eventId}`
    let channel = activeChannels.get(topic)
    if (!channel) {
      channel = supabase.channel(topic, {
        config: { broadcast: { self: true } },
      })
      channel.subscribe()
      activeChannels.set(topic, channel)
    }

    void channel.send({
      type: 'broadcast',
      event: 'countdown_change',
      payload,
    })
  } catch (err) {
    console.warn('[realtime] broadcast countdown_change error:', err)
  }
}

/**
 * Broadcasts an auction break/intermission state to all connected team and admin screens.
 */
export function broadcastBreak(eventId: string, breakState: AuctionBreak | null): void {
  if (!eventId) return

  const payload: BreakBroadcastPayload = {
    eventId,
    break: breakState,
  }

  // 1. Dispatch locally in 0ms
  window.dispatchEvent(
    new CustomEvent('auction:break_change', {
      detail: payload,
    }),
  )

  // 2. Broadcast via Supabase Realtime WebSocket
  try {
    const supabase = getSupabase()
    if (!supabase) return

    const topic = `auction-spotlight:${eventId}`
    let channel = activeChannels.get(topic)
    if (!channel) {
      channel = supabase.channel(topic, {
        config: { broadcast: { self: true } },
      })
      channel.subscribe()
      activeChannels.set(topic, channel)
    }

    void channel.send({
      type: 'broadcast',
      event: 'break_change',
      payload,
    })
  } catch (err) {
    console.warn('[realtime] broadcast break_change error:', err)
  }
}


