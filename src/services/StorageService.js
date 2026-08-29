/**
 * StorageService.js
 * Local persistence for player profile data (callsign, settings).
 *
 * Currently backed by localStorage so the game runs with no backend setup.
 * The public API is shaped like a Firestore document read/write (load/save
 * of a single profile object), so moving to the DB later only requires
 * rewriting this file -- call sites stay unchanged.
 */

const STORAGE_KEY = 'event-horizon:profile';

export const DEFAULT_PROFILE = Object.freeze({
  playerName: 'Pilot',
  settings: Object.freeze({
    muted: false,
  }),
});

export class StorageService {
  /**
   * Read the full profile from local storage, falling back to defaults
   * when nothing is stored yet or the data is corrupt/unavailable.
   */
  load() {
    const fallback = () => ({ ...DEFAULT_PROFILE, settings: { ...DEFAULT_PROFILE.settings } });

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback();

      const parsed = JSON.parse(raw);
      const playerName =
        typeof parsed.playerName === 'string' && parsed.playerName.trim()
          ? parsed.playerName.trim().slice(0, 16)
          : DEFAULT_PROFILE.playerName;
      const muted =
        parsed.settings && typeof parsed.settings.muted === 'boolean'
          ? parsed.settings.muted
          : DEFAULT_PROFILE.settings.muted;

      return { playerName, settings: { muted } };
    } catch (error) {
      console.warn('[Storage] Falling back to defaults:', error);
      return fallback();
    }
  }

  /**
   * Persist the full profile object to local storage.
   */
  save(profile) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (error) {
      console.warn('[Storage] Could not save profile:', error);
    }
  }
}

export default new StorageService();