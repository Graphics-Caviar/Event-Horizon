// Headless DOM/window shims so the real game modules can run in Node.
// This module MUST be imported first: esbuild evaluates dependencies in
// source order, so every game module below sees these globals installed.

const windowListeners = new Map()
const documentListeners = new Map()
export const rafQueue = []

const track = (registry, type, handler) => {
	if (!registry.has(type)) registry.set(type, new Set())
	registry.get(type).add(handler)
}
const untrack = (registry, type, handler) => {
	registry.get(type)?.delete(handler)
}

const makeGradient = () => ({ addColorStop() {} })

const make2DContext = () => ({
	fillStyle: null,
	strokeStyle: null,
	lineWidth: 1,
	font: '',
	textAlign: 'left',
	globalAlpha: 1,
	createRadialGradient: makeGradient,
	createLinearGradient: makeGradient,
	createImageData: (width, height) => ({
		width,
		height,
		data: new Uint8ClampedArray(width * height * 4),
	}),
	putImageData() {},
	getImageData: (x, y, width, height) => ({
		width,
		height,
		data: new Uint8ClampedArray(width * height * 4),
	}),
	fillRect() {},
	clearRect() {},
	strokeRect() {},
	beginPath() {},
	closePath() {},
	arc() {},
	ellipse() {},
	moveTo() {},
	lineTo() {},
	fill() {},
	stroke() {},
	fillText() {},
	measureText: () => ({ width: 10 }),
	save() {},
	restore() {},
	translate() {},
})

export const makeEl = (tag = 'div') => {
	const el = {
		tagName: String(tag).toUpperCase(),
		style: {},
		dataset: {},
		children: [],
		parentNode: null,
		textContent: '',
		innerHTML: '',
		offsetWidth: 0,
		offsetHeight: 0,
		clientWidth: 1280,
		clientHeight: 720,
		hidden: false,
		id: '',
		title: '',
		classList: {
			_set: new Set(),
			add(...names) {
				names.forEach((n) => this._set.add(n))
			},
			remove(...names) {
				names.forEach((n) => this._set.delete(n))
			},
			toggle(name, force) {
				const next =
					force === undefined
						? !this._set.has(name)
						: Boolean(force)
				if (next) this._set.add(name)
				else this._set.delete(name)
				return next
			},
			contains(name) {
				return this._set.has(name)
			},
		},
		appendChild(child) {
			el.children.push(child)
			if (child && typeof child === 'object')
				child.parentNode = el
			return child
		},
		append(...nodes) {
			nodes.forEach((n) => el.appendChild(n))
		},
		remove() {
			if (el.parentNode) {
				const i = el.parentNode.children.indexOf(el)
				if (i >= 0) el.parentNode.children.splice(i, 1)
				el.parentNode = null
			}
		},
		addEventListener() {},
		removeEventListener() {},
		setAttribute() {},
		getAttribute() {
			return null
		},
		querySelector() {
			return makeEl('div')
		},
		querySelectorAll() {
			return []
		},
		contains() {
			return false
		},
		focus() {},
		blur() {},
	}
	// Keep `className` assignments and classList in step (SubtitleOverlay
	// seeds 'hidden' through className, then toggles it via classList).
	Object.defineProperty(el, 'className', {
		get() {
			return [...el.classList._set].join(' ')
		},
		set(value) {
			el.classList._set.clear()
			String(value)
				.split(/\s+/)
				.filter(Boolean)
				.forEach((c) => el.classList._set.add(c))
		},
	})
	if (tag === 'canvas') {
		el.width = 300
		el.height = 150
		el.getContext = () => make2DContext()
	}
	return el
}

export const bodyEl = makeEl('body')

globalThis.document = {
	body: bodyEl,
	documentElement: makeEl('html'),
	hidden: false,
	visibilityState: 'visible',
	activeElement: null,
	fullscreenElement: null,
	createElement: (tag) => makeEl(tag),
	createTextNode: (text) => ({ textContent: text }),
	getElementById: () => null,
	querySelector: () => null,
	querySelectorAll: () => [],
	addEventListener: (type, handler) =>
		track(documentListeners, type, handler),
	removeEventListener: (type, handler) =>
		untrack(documentListeners, type, handler),
	dispatchEvent: () => true,
}

globalThis.window = globalThis
globalThis.innerWidth = 1280
globalThis.innerHeight = 720
globalThis.devicePixelRatio = 1
globalThis.addEventListener = (type, handler) =>
	track(windowListeners, type, handler)
globalThis.removeEventListener = (type, handler) =>
	untrack(windowListeners, type, handler)
globalThis.dispatchEvent = () => true
globalThis.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
})
globalThis.requestAnimationFrame = (callback) => {
	rafQueue.push(callback)
	return rafQueue.length
}
globalThis.cancelAnimationFrame = () => {}
globalThis.getComputedStyle = (el) => el.style
const storage = new Map()
globalThis.localStorage = {
	getItem: (k) => (storage.has(k) ? storage.get(k) : null),
	setItem: (k, v) => storage.set(k, String(v)),
	removeItem: (k) => storage.delete(k),
	clear: () => storage.clear(),
	key: (i) => [...storage.keys()][i] ?? null,
	get length() {
		return storage.size
	},
}
globalThis.location = {
	href: 'http://localhost:5199/',
	origin: 'http://localhost:5199',
	protocol: 'http:',
	pathname: '/',
	search: '',
	hash: '',
}

/** Dispatch a synthetic keyboard event to the registered window listeners. */
export const fireKey = (type, code) => {
	const set = windowListeners.get(type)
	if (!set) return
	const event = {
		code,
		key: code,
		repeat: false,
		preventDefault() {},
		stopPropagation() {},
	}
	for (const handler of [...set]) handler(event)
}

export const hasListener = (type, handler) =>
	windowListeners.get(type)?.has(handler) ?? false

export const listenerCount = (type) => windowListeners.get(type)?.size ?? 0
