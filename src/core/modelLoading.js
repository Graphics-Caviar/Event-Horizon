let pending = 0

// Track in-flight model requests without adding a separate floating status
// widget. Startup owns the blocking progress screen and reports completed
// models there; later scene loads should not create a competing overlay.
export function trackModelLoad(promise) {
	pending++
	return Promise.resolve(promise).finally(() => {
		pending = Math.max(0, pending - 1)
	})
}
