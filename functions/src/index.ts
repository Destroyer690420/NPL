import { initializeApp } from 'firebase-admin/app'
import { setGlobalOptions } from 'firebase-functions/v2'
import { FUNCTIONS_REGION } from './lib/config'

/**
 * Cloud Functions entry point.
 *
 * Every privileged operation of the auction lives here. Clients can never write
 * domain data directly: the Firestore rules deny all client writes.
 */

initializeApp()

setGlobalOptions({
  region: FUNCTIONS_REGION,
  maxInstances: 20,
  memory: '256MiB',
  timeoutSeconds: 60,
})

export { adminLogin } from './callables/adminAuth'
export { verifyTeamPin, getTeamContext, logoutTeamSession } from './callables/teamAuth'
export {
  createTeam,
  updateTeam,
  resetTeamPin,
  revokeSessions,
  getTeamPinStatus,
} from './callables/teams'
export {
  createPlayer,
  updatePlayer,
  setPlayerStatus,
  importPlayers,
} from './callables/players'
export { recordPurchase, reversePurchase } from './callables/purchases'
export {
  createEvent,
  updateEvent,
  checkEventConsistency,
  setDefaultEvent,
} from './callables/event'
