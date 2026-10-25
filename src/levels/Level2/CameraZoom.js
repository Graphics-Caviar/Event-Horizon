// Independent distances preserve each third-person view when boarding.
export class CameraZoom {
	constructor() {
		this.walk = 12
		this.rover = 26
	}

	change(direction, boarded) {
		const key = boarded ? 'rover' : 'walk'
		const min = boarded ? 14 : 4
		const max = boarded ? 48 : 24
		this[key] = Math.max(
			min,
			Math.min(max, this[key] + direction * (boarded ? 2 : 1))
		)
		return this[key]
	}

	static keyDirection(event) {
		if (event.key === '>' || event.code === 'Period') return -1
		if (event.key === '<' || event.code === 'Comma') return 1
		return 0
	}
}
