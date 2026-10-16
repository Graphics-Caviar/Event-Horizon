let pending = 0
let status

function renderStatus() {
	if (typeof document === 'undefined' || !document.body) return
	if (!status && pending) {
		status = document.createElement('div')
		status.setAttribute('role', 'status')
		status.style.cssText =
			'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10000;padding:12px 20px;border:1px solid #447581;border-radius:8px;background:#08131fee;color:#d6f7ff;font:14px system-ui;pointer-events:none'
		document.body.appendChild(status)
	}
	if (status) {
		status.textContent = `Loading models… ${pending} remaining`
		status.hidden = pending === 0
	}
}

// Count complete download-and-parse operations, not individual texture files.
export function trackModelLoad(promise) {
	pending++
	renderStatus()
	return promise.finally(() => {
		pending--
		renderStatus()
	})
}
