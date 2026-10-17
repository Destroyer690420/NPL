import { httpsCallable } from 'firebase/functions'
import { requireFirebase } from '@/lib/firebase'
import { toFriendlyError, type FriendlyError } from '@/lib/errors'
import type { AppErrorCode } from '@shared/errors'

/**
 * Typed wrapper around the Firebase callable transport.
 *
 * Every server failure is converted into a `CallError` carrying a
 * machine-readable code plus user-facing copy, so UI code can react to codes
 * (for example `invalid-pin`, `rate-limited`) without ever parsing messages.
 */

export class CallError extends Error implements FriendlyError {
  readonly code: AppErrorCode
  readonly hint?: string
  readonly retryAfterSeconds?: number
  readonly retryable: boolean

  constructor(friendly: FriendlyError) {
    super(friendly.message)
    this.name = 'CallError'
    this.code = friendly.code
    this.hint = friendly.hint
    this.retryAfterSeconds = friendly.retryAfterSeconds
    this.retryable = friendly.retryable
  }
}

export function isCallError(error: unknown): error is CallError {
  return error instanceof CallError
}

/** Calls a Cloud Function and returns its typed payload. Throws `CallError`. */
export async function callFunction<Input extends object, Output>(
  name: string,
  input: Input,
): Promise<Output> {
  const { functions } = requireFirebase()
  try {
    const callable = httpsCallable<Input, Output>(functions, name)
    const response = await callable(input)
    return response.data
  } catch (error) {
    throw new CallError(toFriendlyError(error))
  }
}
