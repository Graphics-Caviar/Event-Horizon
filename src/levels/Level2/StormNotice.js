/** Bottom HUD stack; one card per local storm, preserving variant colours. */
export class StormNotice {
	constructor() {
		this.element = document.createElement('div')
		this.element.setAttribute('aria-label', 'Gravity storm status')
		Object.assign(this.element.style, {
			position: 'fixed',
			bottom: '20px',
			left: '50%',
			transform: 'translateX(-50%)',
			width: 'min(560px, calc(100vw - 32px))',
			display: 'none',
			gap: '8px',
			zIndex: '34',
			pointerEvents: 'none',
			font: '13px/1.5 monospace',
		})
		document.body.appendChild(this.element)
		this.cards = new Map()
	}

	update(storms, position, visible = true) {
		const present = new Set()
		if (visible)
			for (const storm of storms) {
				const info = storm.notificationAt?.(position)
				if (!info) continue
				present.add(storm)
				let card = this.cards.get(storm)
				if (!card) {
					const element =
						document.createElement('div')
					const title =
						document.createElement('strong')
					const description =
						document.createElement('div')
					const timer =
						document.createElement('div')
					element.append(
						title,
						description,
						timer
					)
					Object.assign(element.style, {
						background: 'rgba(5, 10, 20, .94)',
						padding: '12px 16px',
						border: '1px solid',
						borderLeftWidth: '5px',
						borderRadius: '4px',
						boxShadow: '0 4px 20px #0008',
						color: '#eef6ff',
					})
					timer.style.marginTop = '5px'
					this.element.appendChild(element)
					card = {
						element,
						title,
						description,
						timer,
					}
					this.cards.set(storm, card)
				}
				const color = `#${info.color}`
				card.element.style.borderColor = color
				card.title.style.color = color
				card.title.textContent = `${info.name.toUpperCase()} — ${info.phase === 'forming' ? 'INCOMING' : 'ACTIVE'}`
				card.description.textContent = info.description
				card.timer.textContent = `${info.phase === 'forming' ? 'Effects begin in' : 'Effects end in'} ${info.remaining.toFixed(1)}s`
			}
		for (const [storm, card] of this.cards)
			if (!present.has(storm)) {
				card.element.remove()
				this.cards.delete(storm)
			}
		this.element.style.display = present.size ? 'grid' : 'none'
	}

	dispose() {
		this.cards.clear()
		this.element.remove()
	}
}
