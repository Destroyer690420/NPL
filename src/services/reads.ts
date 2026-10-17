import { doc, getDocFromServer } from 'firebase/firestore'
import { requireFirebase } from '@/lib/firebase'
import { purchaseConverter } from '@/data/converters'
import type { PurchaseDoc } from '@shared/types'

/**
 * Direct one-off reads used for reconciliation. Live data always comes from
 * the snapshot hooks; these are only for explicit "check the server" actions.
 */

/** Reads a purchase by its id (== the idempotency request id) from the server. */
export async function fetchPurchaseFromServer(
  eventId: string,
  purchaseId: string,
): Promise<PurchaseDoc | null> {
  const { db } = requireFirebase()
  const snapshot = await getDocFromServer(
    doc(db, 'events', eventId, 'purchases', purchaseId).withConverter(purchaseConverter),
  )
  return snapshot.data() ?? null
}
