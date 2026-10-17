import { getSupabase } from './supabase'
import type { SpotlightPlayer } from '@shared/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

export interface SpotlightBroadcastPayload {
  eventId: string
  spotlightPlayer: SpotlightPlayer | null
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
        const newData = (payload.new as { data?: { spotlightPlayer?: SpotlightPlayer | null } })?.data
        if (newData) {
          window.dispatchEvent(
            new CustomEvent('auction:spotlight_change', {
              detail: {
                eventId,
                spotlightPlayer: newData.spotlightPlayer ?? null,
              },
            }),
          )
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
