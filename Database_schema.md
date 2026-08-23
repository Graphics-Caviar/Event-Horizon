# Event Horizon: Database Schema

Cloud Firestore schema and data models for **Event Horizon: Escape from Singularity**.

---

## 1. Schema Overview

```
firestore/
├── users/
│   └── {userId}/
│       ├── (user profile document)
│       └── saves/
│           └── {slotId}
├── leaderboards/
│   ├── level_1/scores/{scoreId}
│   ├── level_2/scores/{scoreId}
│   ├── level_3/scores/{scoreId}
│   └── global/scores/{scoreId}
└── achievements/
    └── {achievementId}
```

---

## 2. Collections Specification

### 2.1 `users`
Stores player profile metadata, lifetime stats, and settings.

- **Path:** `/users/{userId}` (`userId` = Firebase Auth `uid`)

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | Unique player ID (Firebase Auth UID) |
| `displayName` | `string` | Pilot callsign (e.g. `Pilot_A8F2`) |
| `createdAt` | `timestamp` | First login timestamp |
| `lastLoginAt` | `timestamp` | Most recent active session |
| `highestUnlockedLevel` | `number` | Highest unlocked level (`1`, `2`, or `3`) |
| `totalNitrogenCollected` | `number` | Total nitrogen harvested across all runs |
| `quantumOverdriveCount` | `number` | Total activations of Quantum Overdrive |
| `settings` | `map` | Player preferences (`masterVolume`, `invertControls`, etc.) |

---

### 2.2 `users/{userId}/saves`
Contains mid-run state snapshots and slot-based save files.

- **Path:** `/users/{userId}/saves/{slotId}` (e.g. `slot_1`, `checkpoint_auto`)

| Field | Type | Description |
|---|---|---|
| `saveId` | `string` | Slot identifier |
| `updatedAt` | `timestamp` | Timestamp of save |
| `currentLevel` | `number` | Active level (`1`, `2`, or `3`) |
| `checkpointId` | `string` | Progress checkpoint marker |
| `health` | `number` | Player hull integrity (0–100) |
| `nitrogenStock` | `number` | Available nitrogen inventory |
| `score` | `number` | Current run score |
| `timeElapsed` | `number` | Level elapsed time in seconds |
| `levelSpecificData` | `map` | Level state: `dimension`, `bossStage`, `gravityInverted` |

---

### 2.3 `leaderboards`
Subcollections for ranking top runs per level and global campaign.

- **Path:** `/leaderboards/{levelId}/scores/{scoreId}`
- **Valid `{levelId}` keys:** `level_1`, `level_2`, `level_3`, `global`

| Field | Type | Description |
|---|---|---|
| `scoreId` | `string` | Document ID |
| `userId` | `string` | Player UID |
| `displayName` | `string` | Pilot callsign recorded at run completion |
| `score` | `number` | Final score achieved |
| `timeElapsed` | `number` | Completion time in seconds (tie-breaker) |
| `nitrogenCollected` | `number` | Canisters collected during the run |
| `achievedAt` | `timestamp` | Server timestamp of completion |

---

### 2.4 `achievements`
Static reference collection for in-game badges and milestone criteria.

- **Path:** `/achievements/{achievementId}`

| Field | Type | Description |
|---|---|---|
| `achievementId` | `string` | Badge key (e.g. `ESCAPE_SINGULARITY`, `OVERDRIVE_MASTER`) |
| `title` | `string` | Badge display title |
| `description` | `string` | Milestone unlock requirement |
| `iconPath` | `string` | Local asset path under `public/assets/images/` |

---

## 3. Firestore Composite Indexes

Required index for querying high scores ordered by highest score and fastest time:

```json
{
  "indexes": [
    {
      "collectionGroup": "scores",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "score", "order": "DESCENDING" },
        { "fieldPath": "timeElapsed", "order": "ASCENDING" }
      ]
    }
  ]
}
```