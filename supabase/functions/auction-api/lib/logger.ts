/**
 * Minimal structured logger for the Edge Function.
 *
 * Replaces the firebase-functions logger so the handler code keeps working
 * unchanged. Output goes to the Supabase Edge Function logs.
 */

type Meta = Record<string, unknown>

function emit(level: 'info' | 'warn' | 'error', message: string, meta?: Meta): void {
  const line = meta && Object.keys(meta).length > 0 ? `${message} ${JSON.stringify(meta)}` : message
  if (level === 'error') console.error(`[error] ${line}`)
  else if (level === 'warn') console.warn(`[warn] ${line}`)
  else console.log(`[info] ${line}`)
}

export const logger = {
  info: (message: string, meta?: Meta) => emit('info', message, meta),
  warn: (message: string, meta?: Meta) => emit('warn', message, meta),
  error: (message: string, meta?: Meta) => emit('error', message, meta),
}
