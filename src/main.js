import { Game } from './core/Game.js'

function boot() {
	// The retired terrain preview URL falls back to index.html in Vite.
	// Canonicalize it so the menu does not keep the deleted page address.
	if (window.location.pathname.endsWith('/level2.html')) {
		const home = new URL('./', window.location.href)
		home.search = window.location.search
		home.hash = window.location.hash
		window.history.replaceState(
			null,
			'',
			home.pathname + home.search + home.hash
		)
	}
	new Game()
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot)
} else {
	boot()
}
