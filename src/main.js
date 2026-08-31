import { Game } from './core/Game.js'

function boot() {
	new Game()
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot)
} else {
	boot()
}
