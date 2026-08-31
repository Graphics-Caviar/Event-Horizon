/**
 * src/components/CharacterModel/CharacterModel.js
 *
 * The reusable per-pilot 3D component described in the brief's
 * "3D CHARACTER SYSTEM" section. One instance per pilot, owned by
 * CharacterSystem. Responsibilities:
 *
 *   - load a GLB via utils/assetLoader, with a visible loading state
 *   - on success: normalize scale/position (GLBs are rarely authored at
 *     a consistent size), set up AnimationMixer, play idle
 *   - on failure: build a clearly-labeled placeholder instead of crashing
 *     or silently showing nothing — the brief requires missing assets to
 *     degrade gracefully, not disable functionality
 *   - if the GLB has no animation clips at all, fall back to a procedural
 *     idle bob/sway rather than a static pose
 *
 * Animation clip names in real GLBs are inconsistent ("Idle", "idle_loop",
 * "CharacterArmature|Idle", etc.), so clips are matched by substring alias
 * rather than exact name.
 *
 * STAGE 5 added `setTargetScale()`: a damped "pulse" layered on top of
 * everything above, driven by CharacterSystem on hover/selection. It
 * applies uniformly whether the model is a real GLB or still showing the
 * loading/error placeholder.
 */

import * as THREE from 'three'
import { loadGLTF } from '../../utils/assetLoader.js'
import { damp } from '../../utils/animations.js'

const TARGET_HEIGHT = 1.75 // world units every pilot is normalized to

const CLIP_ALIASES = {
	idle: ['idle', 'stand', 'breathe'],
	walk: ['walk'],
	run: ['run', 'sprint'],
	attack: ['attack', 'fire', 'shoot'],
	ability: ['ability', 'skill', 'special', 'cast'],
	dodge: ['dodge', 'roll', 'evade'],
	death: ['death', 'die'],
}

function findClip(clips, canonicalName) {
	const aliases = CLIP_ALIASES[canonicalName] ?? [canonicalName]
	return clips.find((clip) =>
		aliases.some((alias) => clip.name.toLowerCase().includes(alias))
	)
}

/** Small canvas-rendered label sprite, used only by the error placeholder. */
function makeLabelSprite(text, color) {
	const canvas = document.createElement('canvas')
	canvas.width = 300
	canvas.height = 64
	const ctx = canvas.getContext('2d')
	ctx.font = '600 22px "Share Tech Mono", monospace'
	ctx.fillStyle = color
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(text, canvas.width / 2, canvas.height / 2)

	const texture = new THREE.CanvasTexture(canvas)
	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthWrite: false,
	})
	const sprite = new THREE.Sprite(material)
	sprite.scale.set(1.6, 0.34, 1)
	return { sprite, texture, material }
}

export default class CharacterModel {
	/**
	 * @param {object} character  entry from data/characters.js
	 * @param {object} [handlers]
	 * @param {(ratio: number) => void} [handlers.onProgress]
	 * @param {(model: CharacterModel) => void} [handlers.onReady]
	 * @param {(err: Error, model: CharacterModel) => void} [handlers.onError]
	 */
	constructor(character, { onProgress, onReady, onError } = {}) {
		this.character = character
		this._onProgress = onProgress
		this._onReady = onReady
		this._onError = onError

		/** 'loading' | 'ready' | 'error' */
		this.state = 'loading'
		this.hasAnimations = false
		this.mixer = null
		this._clips = []
		this._currentAction = null
		this._disposables = []

		this.root = new THREE.Group()
		this.root.name = `CharacterModel-${character.id}`

		// Damped scale used for the hover/selection "pulse" (Stage 5). Applied
		// to `root`, not the normalized inner model, so it never interferes
		// with the height/grounding normalization done in _normalizeTransform.
		this._currentScale = 1
		this._targetScale = 1

		this._buildLoadingPlaceholder()
		this._load()
	}

	/**
	 * Requests a new persistent scale target (e.g. 1.08 when selected,
	 * 1.05 on hover, 0.95 when dimmed by another selection). Eases in via
	 * damping in update() rather than snapping — this is the "character
	 * performs a subtle animation" / "strong glow" feedback from the brief,
	 * and it works identically whether the pilot has a real GLB or is
	 * still showing the loading/error placeholder.
	 */
	setTargetScale(scale) {
		this._targetScale = scale
	}

	_buildLoadingPlaceholder() {
		const geo = new THREE.TorusGeometry(0.4, 0.018, 8, 32)
		const mat = new THREE.MeshBasicMaterial({
			color: this.character.themeColor,
			transparent: true,
			opacity: 0.55,
		})
		this._loadingMesh = new THREE.Mesh(geo, mat)
		this._loadingMesh.position.y = 1
		this._loadingMesh.rotation.x = Math.PI / 2
		this.root.add(this._loadingMesh)
		this._disposables.push(geo, mat)
	}

	async _load() {
		try {
			const gltf = await loadGLTF(
				this.character.model,
				this._onProgress
			)
			this._onModelLoaded(gltf)
		} catch (err) {
			console.warn(
				`[CharacterModel:${this.character.id}] ${err.message}`
			)
			this._onModelFailed(err)
		}
	}

	_onModelLoaded(gltf) {
		this.root.remove(this._loadingMesh)

		const model = gltf.scene
		this._normalizeTransform(model)
		this.root.add(model)
		this.model = model

		if (gltf.animations && gltf.animations.length > 0) {
			this.hasAnimations = true
			this._clips = gltf.animations
			this.mixer = new THREE.AnimationMixer(model)
			this.play('idle')
		} else {
			// Brief's explicit requirement: no clips -> procedural fallback,
			// not a crash and not a frozen pose.
			this.hasAnimations = false
		}

		this.state = 'ready'
		this._onReady?.(this)
	}

	_onModelFailed(err) {
		this.root.remove(this._loadingMesh)
		this._buildErrorFallback()
		this.state = 'error'
		this._onError?.(err, this)
	}

	/**
	 * Visibly-a-placeholder fallback for a missing/broken GLB: a translucent
	 * capsule tinted with the pilot's color plus a "MODEL UNAVAILABLE" label,
	 * so it reads as "asset missing" rather than being mistaken for final art.
	 */
	_buildErrorFallback() {
		const group = new THREE.Group()

		const bodyGeo = new THREE.CapsuleGeometry(0.32, 0.85, 4, 8)
		const bodyMat = new THREE.MeshStandardMaterial({
			color: this.character.themeColor,
			transparent: true,
			opacity: 0.25,
			emissive: this.character.themeColor,
			emissiveIntensity: 0.5,
			roughness: 0.6,
		})
		const body = new THREE.Mesh(bodyGeo, bodyMat)
		this._fallbackBaseY = TARGET_HEIGHT / 2
		body.position.y = this._fallbackBaseY
		group.add(body)

		const { sprite, texture, material } = makeLabelSprite(
			'MODEL UNAVAILABLE',
			this.character.themeColor
		)
		sprite.position.y = TARGET_HEIGHT + 0.35
		group.add(sprite)

		this._fallback = group
		this.root.add(group)
		this._disposables.push(bodyGeo, bodyMat, texture, material)
	}

	/**
	 * Rescales to a consistent height and recenters/grounds the model.
	 * GLBs are rarely authored at the same scale or with feet at the
	 * origin, so every downstream system (slots, camera framing) can
	 * assume TARGET_HEIGHT and y=0-at-feet without knowing anything about
	 * how a given file was modeled.
	 */
	_normalizeTransform(model) {
		const box = new THREE.Box3().setFromObject(model)
		const size = box.getSize(new THREE.Vector3())
		const height = size.y || 1

		model.scale.setScalar(TARGET_HEIGHT / height)

		const scaledBox = new THREE.Box3().setFromObject(model)
		const center = scaledBox.getCenter(new THREE.Vector3())
		model.position.x -= center.x
		model.position.z -= center.z
		model.position.y -= scaledBox.min.y
	}

	/**
	 * @param {'idle'|'walk'|'run'|'attack'|'ability'|'dodge'|'death'} name
	 * @param {{ fade?: number, loop?: boolean }} [options]
	 */
	play(name, { fade = 0.35, loop = true } = {}) {
		if (!this.hasAnimations || !this.mixer) return // procedural fallback owns motion instead

		const clip = findClip(this._clips, name)
		if (!clip) return // missing clip is not an error — just stay on current action

		const nextAction = this.mixer.clipAction(clip)
		nextAction.reset()
		nextAction.setLoop(
			loop ? THREE.LoopRepeat : THREE.LoopOnce,
			Infinity
		)
		nextAction.clampWhenFinished = !loop
		nextAction.play()

		if (this._currentAction && this._currentAction !== nextAction) {
			this._currentAction.crossFadeTo(nextAction, fade, false)
		}
		this._currentAction = nextAction
	}

	/** @param {number} dt seconds since last frame @param {number} elapsed total seconds */
	update(dt, elapsed) {
		this._currentScale = damp(
			this._currentScale,
			this._targetScale,
			6,
			dt
		)
		this.root.scale.setScalar(this._currentScale)

		switch (this.state) {
			case 'loading':
				this._loadingMesh.rotation.z += dt * 2.4
				break

			case 'ready':
				if (this.mixer) {
					this.mixer.update(dt)
				} else {
					this._applyProceduralIdle(
						this.model,
						elapsed,
						0
					)
				}
				break

			case 'error':
				this._applyProceduralIdle(
					this._fallback,
					elapsed,
					0
				)
				this._fallback.rotation.y += dt * 0.3
				break
		}
	}

	_applyProceduralIdle(object3D, elapsed, baseY) {
		if (!object3D) return
		object3D.position.y = baseY + Math.sin(elapsed * 1.4) * 0.035
		object3D.rotation.y = baseY + Math.sin(elapsed * 0.5) * 0.06
	}

	dispose() {
		this.mixer?.stopAllAction()
		for (const item of this._disposables) item?.dispose?.()
		this.root.clear()
	}
}
