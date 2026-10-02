# Backend Setup & Database Guide

This directory contains utility scripts and deployment instructions for the **Event Horizon** Firebase backend services.

---

## 1. Firebase Configuration

Copy `.env.example` to `.env` and configure your Firebase Web App credentials from the Firebase Console:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=event-horizon-game.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=event-horizon-game
VITE_FIREBASE_STORAGE_BUCKET=event-horizon-game.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:...
```

---

## 2. Deploying Rules and Indexes

Deploy your Cloud Firestore security rules and composite indexes to your Firebase project:

```bash
# 1. Login to Firebase
firebase login

# 2. Select Project
firebase use <your-firebase-project-id>

# 3. Deploy Security Rules & Composite Indexes
firebase deploy --only firestore:rules,firestore:indexes
```

---

## 3. Database Seeding Script

To populate the static `achievements` collection and initial leaderboard records:

```bash
npm run seed
```

Or directly:

```bash
node scripts/seedFirestore.js
```

---

## 4. Firebase Local Emulator Suite (Optional)

To test Firebase locally:

```bash
firebase emulators:start
```

- **Emulator UI:** `http://localhost:4000`
- **Firestore Emulator:** `http://localhost:8080`
- **Auth Emulator:** `http://localhost:9099`
