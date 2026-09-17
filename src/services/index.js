/**
 * Services Module Entry Point
 *
 * Most of the game should only need the `backend` facade:
 *
 *   import backend from './services/FirebaseService.js'
 *   backend.init()
 *
 * The individual services are exported for the cases that need them
 * directly (a leaderboard screen, a save/continue menu).
 */

export {
	app,
	auth,
	db,
	analytics,
	firebaseConfig,
	isFirebaseConfigured,
	isFirebaseReady,
	useEmulator,
} from './firebaseConfig.js'

export { default as backend, FirebaseService } from './FirebaseService.js'
export {
	default as authService,
	AuthService,
	validateUsername,
	validatePassword,
	normalizeUsername,
	usernameToEmail,
	emailToUsername,
	USERNAME_MIN,
	USERNAME_MAX,
	PASSWORD_MIN,
} from './AuthService.js'
export { default as profileService, ProfileService } from './ProfileService.js'
export {
	default as saveService,
	SaveService,
	fromGameState,
	AUTO_SLOT,
} from './SaveService.js'
export {
	default as leaderboardService,
	LeaderboardService,
	LEVEL_IDS,
	levelIdFor,
} from './LeaderboardService.js'
export {
	default as achievementService,
	AchievementService,
} from './AchievementService.js'
export {
	default as storage,
	StorageService,
	DEFAULT_PROFILE,
} from './StorageService.js'
