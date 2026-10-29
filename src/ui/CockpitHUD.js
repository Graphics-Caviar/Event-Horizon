/**
 * CockpitHUD.js
 * The first-person cockpit for Level 1: canopy struts, a heading tape with
 * the portal's bearing, a reticle with a flight-path marker, a dashboard of
 * live readouts and a radar scope plotting the asteroid field.
 *
 * The overlay is built here and removed by dispose(); its look lives in
 * public/style.css under "Cockpit". Like HUD.js, update() runs every frame
 * but only writes to the DOM when a shown value changes. The radar redraws
 * on its own slower clock (radarHz), reads positions straight from the
 * AsteroidField, and reuses scratch vectors and buffers so a redraw
 * allocates nothing.
 */
import * as THREE from 'three'

import { formatClock } from './HUD.js'

const TAU = Math.PI * 2
const RAD_TO_DEG = 180 / Math.PI
/** Heading tape scale. Matches the 20px/60px tick spacing in style.css. */
const TAPE_PX_PER_DEG = 4
/** The tape strip runs from -180 to 540 degrees so any heading in 0..360
 * has a full window of ticks either side of it. */
const TAPE_FROM = -180
const TAPE_TO = 540
const TAPE_LABEL_EVERY = 15
/** Radar blips within this many hit-reaches above or below the ship keep a
 * height stalk (a Q/E sidestep could still bring them into play); anything
 * further is drawn faint. */
const NEAR_LEVEL = 4

const COLORS = {
	ring: 'rgba(77, 227, 255, 0.22)',
	rock: 'rgba(223, 252, 255, 0.95)',
	rockNear: 'rgba(150, 190, 210, 0.5)',
	rockFar: 'rgba(150, 190, 210, 0.16)',
	threat: '#ff4d5e',
	canister: '#52ffa8',
	portal: '#4de3ff',
	gravity: '#ffb347',
	ship: '#e8f6ff',
}

const TEMPLATE = `
	<svg class="cockpit-canopy" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
		<defs>
			<linearGradient id="cockpit-metal" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#1a2335" />
				<stop offset="0.55" stop-color="#0b111d" />
				<stop offset="1" stop-color="#05080f" />
			</linearGradient>
			<linearGradient id="cockpit-panel-metal" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#121a2a" />
				<stop offset="1" stop-color="#05080f" />
			</linearGradient>
		</defs>
		<path class="cockpit-glass" d="M0 0 H16 L0 72 Z" />
		<path class="cockpit-glass" d="M100 0 H84 L100 72 Z" />
		<path class="cockpit-strut" d="M0 0 H100 V3.4 Q50 0.8 0 3.4 Z" />
		<path class="cockpit-strut" d="M14 0 H19.5 L2.6 100 H0 V64 Z" />
		<path class="cockpit-strut" d="M86 0 H80.5 L97.4 100 H100 V64 Z" />
	</svg>

	<div class="cockpit-bow">
		<svg class="cockpit-plate" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
			<path d="M0 0 H100 L93 100 H7 Z" />
			<path class="cockpit-plate-edge" d="M100 0 L93 100 H7 L0 0" />
		</svg>
		<div class="cockpit-tape-window">
			<div class="cockpit-tape">
				<div class="cockpit-tape-strip"></div>
			</div>
			<div class="cockpit-tape-portal"></div>
			<div class="cockpit-tape-index"></div>
		</div>
		<div class="cockpit-heading">HDG <strong data-cockpit="heading">000</strong></div>
	</div>

	<svg class="cockpit-reticle" viewBox="-50 -50 100 100" aria-hidden="true">
		<circle r="22" pathLength="100" stroke-dasharray="18 7" stroke-dashoffset="21.5" />
		<path d="M-42 0 H-30 M30 0 H42 M0 30 V36" />
		<circle class="cockpit-reticle-dot" r="1.6" />
	</svg>
	<svg class="cockpit-fpm hidden" viewBox="-20 -20 40 40" aria-hidden="true">
		<circle r="6" />
		<path d="M-6 0 H-15 M6 0 H15 M0 -6 V-12" />
	</svg>

	<div class="cockpit-dash">
		<div class="cockpit-wing cockpit-wing-left">
			<svg class="cockpit-plate" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
				<path d="M0 6 L100 32 V100 H0 Z" />
				<path class="cockpit-plate-edge" d="M0 6 L100 32" />
			</svg>
			<div class="cockpit-panel">
				<div class="cockpit-speed">
					<svg class="cockpit-speed-gauge" viewBox="0 0 100 56" aria-hidden="true">
						<path class="cockpit-gauge-track" d="M8 52 A42 42 0 0 1 92 52" pathLength="100" />
						<path class="cockpit-gauge-fill" data-cockpit="speedArc" d="M8 52 A42 42 0 0 1 92 52" pathLength="100" />
					</svg>
					<div class="cockpit-speed-value">
						<strong data-cockpit="speed">0</strong>
						<span>KM/H</span>
					</div>
				</div>
				<div class="cockpit-stack">
					<div class="cockpit-row">
						<span class="cockpit-label">HULL</span>
						<strong data-cockpit="hull">100%</strong>
					</div>
					<div class="cockpit-bar cockpit-bar-hull">
						<div data-cockpit="hullBar"></div>
					</div>
					<div class="cockpit-row">
						<span class="cockpit-label">TIME</span>
						<strong data-cockpit="time">0:00</strong>
					</div>
					<div class="cockpit-row cockpit-row-minor">
						<span class="cockpit-label">SCORE</span>
						<strong data-cockpit="score">0</strong>
					</div>
				</div>
			</div>
		</div>

		<div class="cockpit-pod">
			<div class="cockpit-scope">
				<canvas class="cockpit-radar"></canvas>
				<div class="cockpit-sweep"></div>
			</div>
			<div class="cockpit-pod-label">
				SCAN <span data-cockpit="range">0</span> m · V EXT VIEW
			</div>
		</div>

		<div class="cockpit-wing cockpit-wing-right">
			<svg class="cockpit-plate" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
				<path d="M100 6 L0 32 V100 H100 Z" />
				<path class="cockpit-plate-edge" d="M100 6 L0 32" />
			</svg>
			<div class="cockpit-panel">
				<div class="cockpit-stack">
					<div class="cockpit-row">
						<span class="cockpit-label">PORTAL</span>
						<strong data-cockpit="portal">0 m</strong>
					</div>
					<div class="cockpit-bar cockpit-bar-escape">
						<div data-cockpit="escapeBar"></div>
					</div>
					<div class="cockpit-row" data-cockpit="hazardRow">
						<span class="cockpit-label">SINGULARITY</span>
						<strong data-cockpit="hazard">0 m</strong>
					</div>
					<div class="cockpit-row">
						<span class="cockpit-label">N₂ CANISTERS</span>
						<strong data-cockpit="nitrogen">0</strong>
					</div>
				</div>
				<div class="cockpit-lamps">
					<div class="cockpit-lamp cockpit-lamp-boost" data-cockpit="boostLamp">
						BOOST <span data-cockpit="boost"></span>
					</div>
					<div class="cockpit-lamp cockpit-lamp-hull" data-cockpit="hullLamp">HULL</div>
					<div class="cockpit-lamp cockpit-lamp-grav" data-cockpit="gravLamp">GRAV</div>
				</div>
			</div>
		</div>
	</div>
`

export class CockpitHUD {
	/**
	 * @param {object} scene what the cockpit instruments look at
	 * @param {object} scene.spaceship the Level 1 Spaceship
	 * @param {object} scene.asteroidField the Level 1 AsteroidField
	 * @param {object} scene.endpoint the escape portal (has .position)
	 * @param {object} scene.blackHole the Level 1 BlackHole (gravity axis)
	 * @param {THREE.Camera} scene.camera projects the flight-path marker
	 * @param {object} [options]
	 * @param {number} [options.radarRange] world units from the ship to the scope's rim
	 * @param {number} [options.radarHz] radar redraws per second
	 */
	constructor(
		{ spaceship, asteroidField, endpoint, blackHole, camera },
		{ radarRange = 600, radarHz = 18 } = {}
	) {
		this.spaceship = spaceship
		this.asteroidField = asteroidField
		this.endpoint = endpoint
		this.blackHole = blackHole
		this.camera = camera
		this.radarRange = radarRange
		this.radarInterval = 1000 / radarHz

		this.root = document.createElement('div')
		this.root.id = 'cockpit'
		this.root.className = 'hidden'
		this.root.setAttribute('aria-hidden', 'true')
		this.root.innerHTML = TEMPLATE
		document.body.appendChild(this.root)

		this.el = {}
		for (const node of this.root.querySelectorAll('[data-cockpit]'))
			this.el[node.dataset.cockpit] = node
		this.el.range.textContent = radarRange
		this.tape = this.root.querySelector('.cockpit-tape-strip')
		this.tapePortal = this.root.querySelector(
			'.cockpit-tape-portal'
		)
		this.fpm = this.root.querySelector('.cockpit-fpm')
		this.scope = this.root.querySelector('.cockpit-scope')
		this.canvas = this.root.querySelector('.cockpit-radar')
		this.ctx = this.canvas.getContext('2d')
		this._buildTape()

		// Scratch space: the per-frame instruments and the radar reuse these.
		this._invQuat = new THREE.Quaternion()
		this._rel = new THREE.Vector3()
		this._forward = new THREE.Vector3()
		this._fpmPoint = new THREE.Vector3()
		this._blips = new Float32Array(0)
		this._threats = null

		this._radarSize = 0 // backing-store pixels, set by _resize()
		this._radarBg = document.createElement('canvas')
		this._radarAt = 0
		this._dpr = 1

		this.visible = false
		this._last = {}
		// Only fires while shown (a hidden scope has no size), which is
		// exactly when the canvas needs sizing.
		this._resizeObserver = new ResizeObserver(() => this._resize())
		this._resizeObserver.observe(this.scope)
	}

	show() {
		if (this.visible) return
		this.visible = true
		// Values may have moved while hidden: rewrite everything once.
		this._last = {}
		this._radarAt = 0
		this.root.classList.remove('hidden')
		// Lets overlays outside the cockpit (radio subtitles) clear the dash.
		document.body.classList.add('cockpit-active')
	}

	hide() {
		if (!this.visible) return
		this.visible = false
		this.root.classList.add('hidden')
		document.body.classList.remove('cockpit-active')
	}

	/**
	 * Takes the same state Level 1 hands HUD.update, plus a few cockpit-only
	 * readouts. Does nothing while hidden.
	 * @param {object} state
	 * @param {number} state.integrity 0..100
	 * @param {number} state.progress 0..1 of the way to escape
	 * @param {number} state.score
	 * @param {number} state.time seconds elapsed
	 * @param {boolean} state.warning close to the event horizon
	 * @param {number} state.speed
	 * @param {number} state.maxSpeed current speed ceiling (doubles on boost)
	 * @param {number} state.nitrogen canisters collected
	 * @param {number} state.boostTime seconds of boost left
	 * @param {number} state.portalDistance ship to the escape portal
	 * @param {number} state.hazardDistance signed distance from the black hole
	 * @param {object[]} [state.threats] asteroids to paint red on the radar,
	 *   e.g. the rocks a collision predictor has flagged
	 */
	update(state) {
		if (!this.visible) return
		this._updateReadouts(state)
		this._threats = state.threats || null
		this._invQuat.copy(this.spaceship.shipGroup.quaternion).invert()
		this._updateHeading()
		this._updateFlightPath()

		const now = performance.now()
		if (now - this._radarAt >= this.radarInterval) {
			this._radarAt = now
			this._drawRadar()
		}
	}

	dispose() {
		this.hide()
		this._resizeObserver.disconnect()
		this.root.remove()
	}

	_updateReadouts({
		integrity,
		progress,
		score,
		time,
		warning,
		speed,
		maxSpeed,
		nitrogen,
		boostTime,
		portalDistance,
		hazardDistance,
	}) {
		const el = this.el
		const last = this._last

		const shownSpeed = Math.round(speed)
		if (shownSpeed !== last.speed) {
			last.speed = shownSpeed
			el.speed.textContent = shownSpeed
		}
		const arc = Math.round(
			Math.min(1, speed / Math.max(maxSpeed, 1)) * 100
		)
		if (arc !== last.arc) {
			last.arc = arc
			el.speedArc.style.strokeDashoffset = 100 - arc
		}

		// Same thresholds as the flat HUD's hull bar.
		const hull = Math.max(0, Math.round(integrity))
		if (hull !== last.hull) {
			last.hull = hull
			el.hull.textContent = `${hull}%`
			el.hullBar.style.width = `${hull}%`
			const status =
				hull > 50
					? ''
					: hull > 25
						? 'is-warn'
						: 'is-crit'
			el.hullBar.className = status
			el.hullLamp.className = `cockpit-lamp cockpit-lamp-hull ${status}`
		}

		const clock = formatClock(time)
		if (clock !== last.clock) {
			last.clock = clock
			el.time.textContent = clock
		}

		const shownScore = Math.max(0, Math.floor(score))
		if (shownScore !== last.score) {
			last.score = shownScore
			el.score.textContent = shownScore.toLocaleString()
		}

		const portal = Math.max(0, Math.ceil(portalDistance))
		if (portal !== last.portal) {
			last.portal = portal
			el.portal.textContent = `${portal.toLocaleString()} m`
		}

		const pct = Math.max(
			0,
			Math.min(100, Math.floor(progress * 100))
		)
		if (pct !== last.pct) {
			last.pct = pct
			el.escapeBar.style.width = `${pct}%`
		}

		const hazard = Math.max(0, Math.round(hazardDistance))
		if (hazard !== last.hazard) {
			last.hazard = hazard
			el.hazard.textContent = `${hazard.toLocaleString()} m`
		}

		const critical = Boolean(warning)
		if (critical !== last.warning) {
			last.warning = critical
			el.hazardRow.classList.toggle('is-crit', critical)
			el.gravLamp.classList.toggle('is-on', critical)
		}

		if (nitrogen !== last.nitrogen) {
			last.nitrogen = nitrogen
			el.nitrogen.textContent = nitrogen
		}

		const boost = Math.ceil(boostTime)
		if (boost !== last.boost) {
			last.boost = boost
			el.boost.textContent = boost > 0 ? `${boost}s` : ''
			el.boostLamp.classList.toggle('is-on', boost > 0)
			el.speedArc.classList.toggle('is-boost', boost > 0)
		}
	}

	/** Heading 000 points at the escape portal (+z, away from the hole);
	 * it increases clockwise, so turning right (D) counts up. */
	_updateHeading() {
		const ship = this.spaceship
		const forward = this._forward
			.set(0, 0, -1)
			.applyQuaternion(ship.shipGroup.quaternion)
		let heading = Math.atan2(-forward.x, forward.z) * RAD_TO_DEG
		if (heading < 0) heading += 360

		const tape = Math.round(heading * 10) / 10
		if (tape !== this._last.tape) {
			this._last.tape = tape
			this.tape.style.transform = `translateX(${-(tape - TAPE_FROM) * TAPE_PX_PER_DEG}px)`
		}
		const shown = Math.round(heading) % 360
		if (shown !== this._last.heading) {
			this._last.heading = shown
			this.el.heading.textContent = String(shown).padStart(
				3,
				'0'
			)
		}

		// Portal bearing off the nose; style.css pins the caret to the
		// tape's edge once the portal is outside the window.
		const rel = this._rel
			.subVectors(this.endpoint.position, ship.position)
			.applyQuaternion(this._invQuat)
		const bearing = Math.round(
			Math.atan2(rel.x, -rel.z) * RAD_TO_DEG
		)
		if (bearing !== this._last.bearing) {
			this._last.bearing = bearing
			this.tapePortal.style.setProperty('--bearing', bearing)
		}
	}

	/** Where the ship is actually going. Gravity drags it off the nose, so
	 * this drifts away from the reticle; hidden when flying backwards. */
	_updateFlightPath() {
		const velocity = this.spaceship.velocity
		const speedSq = velocity.lengthSq()
		let shown = false
		let x = 0
		let y = 0
		if (speedSq > 4) {
			const camera = this.camera
			camera.updateMatrixWorld()
			const p = this._fpmPoint
				.copy(velocity)
				.multiplyScalar(60 / Math.sqrt(speedSq))
				.add(camera.position)
				.project(camera)
			shown =
				p.z < 1 &&
				Math.abs(p.x) < 0.95 &&
				Math.abs(p.y) < 0.95
			// Viewport units, to a tenth: no layout reads needed.
			x = Math.round((p.x + 1) * 500) / 10
			y = Math.round((1 - p.y) * 500) / 10
		}
		if (shown !== this._last.fpmShown) {
			this._last.fpmShown = shown
			this.fpm.classList.toggle('hidden', !shown)
		}
		if (shown && (x !== this._last.fpmX || y !== this._last.fpmY)) {
			this._last.fpmX = x
			this._last.fpmY = y
			this.fpm.style.transform = `translate(${x}vw, ${y}vh)`
		}
	}

	_buildTape() {
		for (
			let deg = TAPE_FROM;
			deg <= TAPE_TO;
			deg += TAPE_LABEL_EVERY
		) {
			const label = document.createElement('span')
			label.textContent = String(
				((deg % 360) + 360) % 360
			).padStart(3, '0')
			label.style.left = `${(deg - TAPE_FROM) * TAPE_PX_PER_DEG}px`
			this.tape.appendChild(label)
		}
		this.tape.style.width = `${(TAPE_TO - TAPE_FROM) * TAPE_PX_PER_DEG}px`
	}

	/** Size the canvas to the scope's CSS box at device resolution and
	 * repaint the static rings into an offscreen canvas. */
	_resize() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2)
		const size = Math.round(this.scope.clientWidth * dpr)
		if (size === this._radarSize && dpr === this._dpr) return
		this._dpr = dpr
		this._radarSize = size
		this._markerFont = `bold ${9 * dpr}px 'Courier New', monospace`
		this.canvas.width = this.canvas.height = size
		this._radarBg.width = this._radarBg.height = size
		if (size === 0) return
		this._paintRadarBackground()
		this._drawRadar()
	}

	_paintRadarBackground() {
		const ctx = this._radarBg.getContext('2d')
		const size = this._radarSize
		const half = size / 2
		const rim = this._radarRim()
		const dpr = this._dpr

		const glow = ctx.createRadialGradient(
			half,
			half,
			0,
			half,
			half,
			half
		)
		glow.addColorStop(0, 'rgba(10, 40, 60, 0.85)')
		glow.addColorStop(1, 'rgba(2, 8, 16, 0.95)')
		ctx.fillStyle = glow
		ctx.beginPath()
		ctx.arc(half, half, half, 0, TAU)
		ctx.fill()

		ctx.strokeStyle = COLORS.ring
		ctx.lineWidth = dpr
		ctx.beginPath()
		for (const f of [1 / 3, 2 / 3, 1]) {
			ctx.moveTo(half + rim * f, half)
			ctx.arc(half, half, rim * f, 0, TAU)
		}
		ctx.moveTo(half - rim, half)
		ctx.lineTo(half + rim, half)
		ctx.moveTo(half, half - rim)
		ctx.lineTo(half, half + rim)
		ctx.stroke()

		// Rough forward field of view, so the scope reads as heading-up.
		const spread = rim * Math.tan(Math.PI / 4)
		ctx.strokeStyle = 'rgba(77, 227, 255, 0.12)'
		ctx.beginPath()
		ctx.moveTo(half, half)
		ctx.lineTo(half - spread * 0.7, half - rim * 0.7)
		ctx.moveTo(half, half)
		ctx.lineTo(half + spread * 0.7, half - rim * 0.7)
		ctx.stroke()
	}

	_radarRim() {
		return this._radarSize / 2 - 4 * this._dpr
	}

	/**
	 * Heading-up plot of everything within radarRange, in three tiers by
	 * height so the scope does not drown in rocks that cannot hit:
	 * at the ship's own height (close enough to hit it) bright; a little
	 * above or below dimmed, with a stalk pointing up or down; well clear
	 * of the ship faint.
	 */
	_drawRadar() {
		const size = this._radarSize
		if (!size) return
		const ctx = this.ctx
		const dpr = this._dpr
		const half = size / 2
		const rim = this._radarRim()
		const scale = rim / this.radarRange
		const rangeSq = this.radarRange * this.radarRange
		const ship = this.spaceship
		const field = this.asteroidField
		const asteroids = field.asteroids
		const inv = this._invQuat
		const rel = this._rel

		ctx.clearRect(0, 0, size, size)
		ctx.drawImage(this._radarBg, 0, 0)

		if (this._blips.length < asteroids.length * 4)
			this._blips = new Float32Array(asteroids.length * 4)
		const blips = this._blips
		let n = 0
		for (let i = 0; i < asteroids.length; i++) {
			const a = asteroids[i]
			rel.subVectors(a.position, ship.position)
			if (rel.lengthSq() > rangeSq) continue
			rel.applyQuaternion(inv)
			const reach =
				ship.collisionRadius +
				field.modelRadius * a.scale
			blips[n] = half + rel.x * scale
			blips[n + 1] = half + rel.z * scale
			blips[n + 2] = (0.8 + a.scale * 0.85) * dpr
			const height = Math.abs(rel.y)
			const tier =
				height <= reach
					? 0
					: height <= reach * NEAR_LEVEL
						? 1
						: 2
			blips[n + 3] = rel.y < 0 ? -tier : tier
			n += 4
		}

		this._fillBlips(blips, n, 2, COLORS.rockFar, 0.7)
		this._fillBlips(blips, n, 1, COLORS.rockNear, 0.85)
		ctx.strokeStyle = COLORS.rockNear
		ctx.lineWidth = dpr
		ctx.beginPath()
		for (let i = 0; i < n; i += 4) {
			const tier = blips[i + 3]
			if (tier !== 1 && tier !== -1) continue
			ctx.moveTo(blips[i], blips[i + 1])
			ctx.lineTo(blips[i], blips[i + 1] - tier * 5 * dpr)
		}
		ctx.stroke()
		this._fillBlips(blips, n, 0, COLORS.rock, 1)

		this._drawThreats(half, scale, rangeSq)
		this._drawCanisters(half, scale, rangeSq)

		// Edge markers: where the portal is, and which way gravity pulls.
		rel.subVectors(
			this.endpoint.position,
			ship.position
		).applyQuaternion(inv)
		this._drawMarker(rel, half, rim, scale, COLORS.portal, 'P')
		rel.copy(this.blackHole.planeNormal)
			.negate()
			.applyQuaternion(inv)
		this._drawMarker(rel, half, rim, 0, COLORS.gravity, 'G')

		// The ship, nose up.
		const s = 5 * dpr
		ctx.fillStyle = COLORS.ship
		ctx.beginPath()
		ctx.moveTo(half, half - s)
		ctx.lineTo(half + s * 0.7, half + s * 0.8)
		ctx.lineTo(half, half + s * 0.35)
		ctx.lineTo(half - s * 0.7, half + s * 0.8)
		ctx.closePath()
		ctx.fill()
	}

	/** One fill for every blip in a height tier. */
	_fillBlips(blips, n, tier, color, size) {
		const ctx = this.ctx
		ctx.fillStyle = color
		ctx.beginPath()
		for (let i = 0; i < n; i += 4) {
			if (Math.abs(blips[i + 3]) !== tier) continue
			const r = blips[i + 2] * size
			ctx.moveTo(blips[i] + r, blips[i + 1])
			ctx.arc(blips[i], blips[i + 1], r, 0, TAU)
		}
		ctx.fill()
	}

	/** Red rings around asteroids someone else has flagged as a threat. */
	_drawThreats(half, scale, rangeSq) {
		const threats = this._threats
		if (!threats || !threats.length) return
		const ctx = this.ctx
		const dpr = this._dpr
		const rel = this._rel
		const ship = this.spaceship
		ctx.strokeStyle = COLORS.threat
		ctx.fillStyle = COLORS.threat
		ctx.lineWidth = 1.5 * dpr
		for (let i = 0; i < threats.length; i++) {
			const a = threats[i]
			rel.subVectors(a.position, ship.position)
			if (rel.lengthSq() > rangeSq) continue
			rel.applyQuaternion(this._invQuat)
			const x = half + rel.x * scale
			const y = half + rel.z * scale
			const r = (0.8 + a.scale * 0.85) * dpr
			ctx.beginPath()
			ctx.arc(x, y, r, 0, TAU)
			ctx.fill()
			ctx.beginPath()
			ctx.arc(x, y, r + 3 * dpr, 0, TAU)
			ctx.stroke()
		}
	}

	/** Nitrogen canisters as small green diamonds: worth steering into. */
	_drawCanisters(half, scale, rangeSq) {
		const canisters = this.asteroidField.canisters
		const ctx = this.ctx
		const rel = this._rel
		const ship = this.spaceship
		const d = 3 * this._dpr
		ctx.fillStyle = COLORS.canister
		ctx.beginPath()
		for (let i = 0; i < canisters.length; i++) {
			rel.subVectors(canisters[i].position, ship.position)
			if (rel.lengthSq() > rangeSq) continue
			rel.applyQuaternion(this._invQuat)
			const x = half + rel.x * scale
			const y = half + rel.z * scale
			ctx.moveTo(x, y - d)
			ctx.lineTo(x + d, y)
			ctx.lineTo(x, y + d)
			ctx.lineTo(x - d, y)
			ctx.closePath()
		}
		ctx.fill()
	}

	/**
	 * Plot a ship-local direction or offset. With scale 0, or once it is
	 * past the rim, it is pinned to the rim as a lettered tab.
	 */
	_drawMarker(local, half, rim, scale, color, letter) {
		const ctx = this.ctx
		const dpr = this._dpr
		const flat = Math.hypot(local.x, local.z)
		if (flat < 1e-6) return
		const plotted = flat * scale
		const onScope = scale > 0 && plotted <= rim
		const dist = onScope ? plotted : rim - 7 * dpr
		const x = half + (local.x / flat) * dist
		const y = half + (local.z / flat) * dist

		ctx.fillStyle = color
		ctx.strokeStyle = color
		ctx.lineWidth = 1.5 * dpr
		if (onScope) {
			const r = 5 * dpr
			ctx.beginPath()
			ctx.moveTo(x, y - r)
			ctx.lineTo(x + r, y)
			ctx.lineTo(x, y + r)
			ctx.lineTo(x - r, y)
			ctx.closePath()
			ctx.stroke()
			return
		}
		ctx.beginPath()
		ctx.arc(x, y, 6.5 * dpr, 0, TAU)
		ctx.fill()
		ctx.fillStyle = '#04101a'
		ctx.font = this._markerFont
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillText(letter, x, y + 0.5 * dpr)
	}
}
