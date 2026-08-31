/**
 * FirebaseService.js
 * Database and Authentication connection for Event Horizon.
 */

import { app, auth, db, analytics } from './firebaseConfig.js'

// Export initialized Firebase database and auth connection instances
export { app, auth, db, analytics }
export default db
