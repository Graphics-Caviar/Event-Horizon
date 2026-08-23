export class Menu {
  constructor({ onStart, onRetry }) {
    this.screens = {
      start: document.getElementById('screen-start'),
      gameover: document.getElementById('screen-gameover'),
      complete: document.getElementById('screen-complete'),
    };

    this.nameInput = document.getElementById('player-name-input');

    const launch = () => onStart(this._readName());
    document.getElementById('btn-start').addEventListener('click', launch);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') launch();
    });

    // Gameover/complete screens don't exist yet in a launch-only build —
    // only wire these up if the markup is actually present.
    const retryGameover = document.getElementById('btn-retry-gameover');
    if (retryGameover) retryGameover.addEventListener('click', onRetry);

    const retryComplete = document.getElementById('btn-retry-complete');
    if (retryComplete) retryComplete.addEventListener('click', onRetry);
  }

  _readName() {
    const raw = this.nameInput.value.trim();
    return raw.length > 0 ? raw : 'Pilot';
  }

  _hideAll() {
    Object.values(this.screens).forEach((el) => el && el.classList.add('hidden'));
  }

  showStart() {
    this._hideAll();
    this.screens.start.classList.remove('hidden');
    this.nameInput.focus();
  }

  showGameOver(finalScore, playerName) {
    if (!this.screens.gameover) return;
    this._hideAll();
    document.getElementById('gameover-lore').textContent =
      `The black hole reclaimed ${playerName}'s ship. The Devourer is patient — you were not fast enough.`;
    document.getElementById('final-score-gameover').textContent = `Final score: ${Math.floor(finalScore)}`;
    this.screens.gameover.classList.remove('hidden');
  }

  showComplete(finalScore, playerName) {
    if (!this.screens.complete) return;
    this._hideAll();
    document.getElementById('complete-lore').textContent =
      `${playerName} breaks free of the singularity's grasp — but the ship can't take much more. ` +
      `Control fails as you streak toward a nearby alien world...`;
    document.getElementById('final-score-complete').textContent = `Final score: ${Math.floor(finalScore)}`;
    this.screens.complete.classList.remove('hidden');
  }

  hideAll() { this._hideAll(); }
}