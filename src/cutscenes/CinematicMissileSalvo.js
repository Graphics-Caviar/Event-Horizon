import * as THREE from 'three'
import { CinematicMissileStrike } from './CinematicMissileStrike.js'

// Three accompanying near misses; the host's primary strike owns rover damage,
// warning audio and camera choreography. Fixed timing avoids frame-rate drift.
export class CinematicMissileSalvo {
	constructor({ impact, heightAt, duration = 3.2 }) {
		this.group = new THREE.Group()
		this.group.name = 'cinematic-missile-salvo'
		this.elapsed = 0
		this.disposed = false
		this.missiles = [
			{ x: -24, z: -20, delay: 0.12, extra: 0.03 },
			{ x: -42, z: 14, delay: 0.3, extra: 0.05 },
			{ x: -62, z: -12, delay: 0.5, extra: 0.1 },
		].map((def, index) => {
			const target = impact
				.clone()
				.add(new THREE.Vector3(def.x, 0, def.z))
			target.y = heightAt(target.x, target.z)
			const start = impact
				.clone()
				.add(
					new THREE.Vector3(
						-104 - index * 12,
						158 + index * 12,
						-76 + index * 15
					)
				)
			const strike = new CinematicMissileStrike({
				start,
				impact: target,
				heightAt,
			})
			strike.group.visible = false
			this.group.add(strike.group)
			return {
				strike,
				delay: def.delay,
				duration: duration + def.extra,
			}
		})
	}

	update(delta) {
		if (this.disposed || !Number.isFinite(delta) || delta < 0)
			return
		this.elapsed += delta
		for (const entry of this.missiles) {
			const age = this.elapsed - entry.delay
			if (age < 0) continue
			const strike = entry.strike
			strike.group.visible = true
			if (!strike.impacted) {
				const t = Math.min(1, age / entry.duration)
				strike.setFlightProgress(t * t)
				if (t >= 1) {
					strike.impact()
					strike.update(
						Math.max(
							0,
							age - entry.duration
						)
					)
				}
			} else strike.update(delta)
		}
	}

	dispose() {
		if (this.disposed) return
		this.disposed = true
		for (const entry of this.missiles) entry.strike.dispose()
		this.group.removeFromParent()
		this.group.clear()
	}
}
