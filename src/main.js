import { Game } from './core/Game.js';

function boot() {
  window.game = new Game();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
