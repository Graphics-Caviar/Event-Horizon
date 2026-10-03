# Backend Setup & Database Guide

Utility scripts and setup steps for the **Event Horizon** Firebase backend.

> **Current status of project `event-horizon-335a2`** (last probed
> 2026-09-17):
>
> | Piece                   | State                                    |
> | ----------------------- | ---------------------------------------- |
> | Project + API key       | ✅ valid                                 |
> | Email/Password provider | ✅ enabled — accounts work               |
> | Anonymous provider      | ❌ off — "Continue as guest" unavailable |
> | **Firestore database**  | ❌ **not created** — see step 2          |
>
> Accounts can be created, but nothing can be stored: every Firestore call
> fails. Until step 2 is done the game still plays and saves to
> `localStorage`, and the console says so on boot.
>
> **This is also the cause of any slow sign-up** — see section 8. A read
> against a non-existent database takes ~35s in the browser before the SDK
> gives up. Creating the database removes the delay entirely; the timeouts
> in section 8 keep it from ever hanging the UI again.

---

## 1. Environment configuration

Copy `.env.example` to `.env` and fill in the Firebase Web App credentials
from Firebase Console -> Project Settings -> General -> Your Apps:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=event-horizon-335a2.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=event-horizon-335a2
VITE_FIREBASE_STORAGE_BUCKET=event-horizon-335a2.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:...
```

`.env` is gitignored. Nothing in the repo hardcodes credentials any more, so
the game and the seed script can never drift onto different projects.

---

## 2. Create the Firestore database (required, console only)

Firebase Console -> Build -> **Firestore Database** -> Create database.

- Location: pick one near your users and **note it — it cannot be changed**.
- Start in **production mode**. The rules in `firestore.rules` are the real
  ones; see step 5 for the seeding order that production mode implies.

Without this, every Firestore call fails with:

```
5 NOT_FOUND / The database (default) does not exist for project ...
```

## 3. Enable authentication providers (required, console only)

Firebase Console -> Build -> **Authentication** -> Get started ->
Sign-in method, then enable:

| Provider           | Needed for                                             |
| ------------------ | ------------------------------------------------------ |
| **Email/Password** | player accounts (the callsign + password login screen) |
| **Anonymous**      | the "Continue as guest" option                         |

Players sign in with a **callsign and password**, not an email address.
Firebase Auth has no username provider, so `AuthService` maps a callsign to
a synthetic address that never receives mail:

```
"Nova_7"  ->  "nova_7@pilots.eventhorizon.game"
```

That gets Firebase's uniqueness check for free (a taken callsign surfaces as
`auth/email-already-in-use`) and leaves `firestore.rules` untouched, since
the rules only ever look at `uid`.

> **No password recovery.** Because those addresses are not real inboxes,
> there is no password reset and no email verification. A forgotten password
> needs an admin to delete the account from the console. Fine for a course
> project; a production game would collect a real email for recovery.

**Passwords are never stored by this app.** Firebase Authentication hashes
and holds them. Nothing in `src/services/` writes a password into Firestore,
and the plaintext never leaves the sign-in call.

Without these providers, sign-in fails with `auth/configuration-not-found`
(or `auth/operation-not-allowed`), the registry screen says so, and the game
offers offline play instead.

---

## 4. Deploy rules and indexes

```bash
firebase login
firebase use event-horizon-335a2
firebase deploy --only firestore:rules,firestore:indexes
```

The composite index (`score DESC, timeElapsed ASC`) is what makes the
leaderboard query work. Without it, `getTopScores()` fails with
`failed-precondition` and logs a link that creates the index.

---

## 5. Seeding

```bash
npm run seed
```

**Leaderboard rows seed fine.** The script signs in anonymously and stamps
that `uid` on each row, which is what the rules require. They are demo rows
owned by one seed account, not real per-player entries.

**Achievements cannot be seeded by this script.** `firestore.rules` sets
`/achievements` to `allow write: if false`, which applies to every
client-SDK caller regardless of auth — and the emulator loads the same rules
file, so pointing the script at the emulator does **not** get round it.
Verified against the emulator: `0/7 achievements, 8 leaderboard rows`,
denied at `firestore.rules` L48. Pick one:

| Approach                                            | How                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Seed before deploy** (easiest on a fresh project) | Create the DB in **test mode**, `npm run seed`, _then_ deploy rules (step 4)                                                       |
| **Admin SDK** (most robust)                         | Port the script to `firebase-admin`, which bypasses rules. Needs a devDependency; no service account required against the emulator |
| **Temporarily relax the rule**                      | Loosen `/achievements` write, seed, restore. Quick, but easy to forget to undo                                                     |
| **By hand**                                         | Add the 7 documents in the Firebase console or Emulator UI                                                                         |

---

## 6. Local Emulator Suite

```bash
firebase emulators:start
```

Then set `VITE_FIREBASE_USE_EMULATOR=true` in `.env` and restart the dev
server. The game and the seed script both honour the flag.

- **Emulator UI:** http://localhost:4000
- **Firestore:** :8080 · **Auth:** :9099

This needs no console setup, no live database and no cost, so it is the
fastest way to develop and demo the backend. The emulator loads
`firestore.rules`, so it also tests the rules rather than bypassing them.

### Verifying the backend

```bash
firebase emulators:start --only auth,firestore --project demo-event-horizon
npm run test:backend
```

`scripts/testBackend.js` runs 66 assertions covering callsign/password
validation, account creation, duplicate and wrong-password handling,
case-insensitive sign-in, sign-out state clearing, guest sessions, profile
create/merge, the local→cloud mirror, save slots, leaderboard
submit/ordered-read, lifetime counters, achievement unlocks, and every deny
case in `firestore.rules`. It forces a `demo-` project id, so it can never
touch the live project. Run it after changing a service or the rules.

The callsigns and passwords it uses are throwaway fixtures created in the
local emulator — never point it at a live project.

---

## 7. What the game actually does with Firebase

| Service              | Path                             | When                                             |
| -------------------- | -------------------------------- | ------------------------------------------------ |
| `AuthService`        | Firebase Auth                    | callsign/password accounts + guest sessions      |
| `ProfileService`     | `/users/{uid}`                   | created/merged on sign-in; mirrors profile edits |
| `SaveService`        | `/users/{uid}/saves/{slotId}`    | throttled autosave + checkpoint writes           |
| `LeaderboardService` | `/leaderboards/{levelId}/scores` | on run submission                                |
| `AchievementService` | `/achievements`                  | definitions read once per session                |

Everything funnels through the `backend` facade:

```js
import backend from './services/FirebaseService.js'

await backend.init() // Game.js already does this at boot; signs nobody in
backend.status() // { configured, ready, signedIn, isGuest, username, uid, ... }

await backend.signUp('Nova_7', password)
await backend.signIn('Nova_7', password) // case-insensitive
await backend.signInAsGuest()
await backend.signOut()

await backend.submitRun(gameState, { completed: true })
await backend.saveCheckpoint(gameState)
await backend.leaderboard.getTopScores('level_1', 10)
```

### Screen flow

```
Main menu ── PLAY ──> Pilot registry ──> Hangar ──> Level 1
    │                 (sign in / new pilot / guest)
    └── LEADERBOARD ─> Leaderboard screen
```

`init()` restores a persisted session but never signs anyone in, so the
registry stays in charge of authentication. A signed-in session survives a
reload (Firebase persists it in IndexedDB), so PLAY goes straight to the
hangar on the next visit.

**Design rule:** no backend call can break the game. If Firebase is
unconfigured, unprovisioned or offline, every method resolves to
`null`/`false`/`[]`, logs one warning, the registry offers offline play, and
the game continues on `localStorage`. Sign-in is required to play only when
the backend is actually reachable.

---

## 8. Timeouts — why they exist

The Firestore SDK has **no request timeout**, and its failure modes are much
slower than you would guess:

| Situation (browser, measured)   | Behaviour               |
| ------------------------------- | ----------------------- |
| Read, database does not exist   | ~35s before it gives up |
| Read, connection refused        | ~2s                     |
| **Write, no reachable backend** | **never settles**       |

That last row is the one that bites. `setDoc()` resolves only when the
server acknowledges the write — with no backend the SDK queues it locally
and retries indefinitely, so the promise stays pending forever.

Awaiting the profile sync during sign-up therefore made account creation
_look_ like it took 35 seconds, when the account itself was created in
~0.1s. [`src/services/timeout.js`](../src/services/timeout.js) fixes that on
two levels:

- **`withTimeout` (8s)** wraps every Firestore call in every service, so a
  broken backend degrades to local-only in seconds instead of hanging.
- **`withBudget` (2.5s)** bounds how long sign-in/sign-up/boot wait for the
  profile sync. The sync keeps running in the background and the auth
  listener re-emits when it lands, so the greeting and cached profile catch
  up on their own.

Measured on this project with no Firestore database: sign-up spinner went
from **35.5s to ~2.6s worst case**, and **423ms** against a healthy backend.

**A timed-out write is not cancelled.** The SDK replays queued writes when
connectivity returns, so it may still land later. Timing out only stops the
game _waiting_ for it — the local copy is already saved either way.
