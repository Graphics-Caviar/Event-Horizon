/** Ship configuration used by the ship-selection UI and 3D hangar preview. */
export const SHIPS = {
	vanguard: {
		key: 'vanguard',
		name: 'Vanguard',
		mark: 'VG-07',
		role: 'Balanced Assault Craft',
		model: [
			'/assets/models/spaceship/spaceship.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/spaceship/spaceship.glb',
		],
		tagline: '"Ready for anything."',
		description:
			'A balanced multi-role spacecraft combining reliable speed, protection and handling for unpredictable missions.',
		stats: {
			speed: 8,
			firepower: 8,
			durability: 7,
			shields: 7,
			agility: 8,
		},
		specs: [
			{ label: 'Engine', value: 'Vector Fusion Drive' },
			{ label: 'Hull', value: 'Composite Battleframe' },
			{ label: 'Shielding', value: 'Adaptive Barrier' },
			{ label: 'Specialty', value: 'Balanced Performance' },
		],
		accentClass: 'accent-green',
	},
	starfighter: {
		key: 'starfighter',
		name: 'Starfighter',
		mark: 'SF-01',
		role: 'High-Speed Interceptor',
		model: '/assets/models/spaceship/starfighter.glb',
		tagline: '"Speed is survival."',
		description:
			'A lightweight interceptor designed for rapid acceleration, tight manoeuvres and escaping extreme gravitational fields.',
		stats: {
			speed: 10,
			firepower: 7,
			durability: 5,
			shields: 6,
			agility: 10,
		},
		specs: [
			{ label: 'Engine', value: 'Twin Plasma Drives' },
			{ label: 'Hull', value: 'Light Carbon Composite' },
			{ label: 'Shielding', value: 'Phase Barrier' },
			{ label: 'Specialty', value: 'Extreme Agility' },
		],
		accentClass: 'accent-cyan',
	},
	aegis: {
		key: 'aegis',
		name: 'Aegis',
		mark: 'AE-09',
		role: 'Heavy Explorer',
		model: '/assets/models/spaceship/aegis.glb',
		tagline: '"Built to survive the impossible."',
		description:
			'A heavily reinforced exploration vessel designed to endure asteroid impacts, gravitational instability and deep-space missions.',
		stats: {
			speed: 6,
			firepower: 8,
			durability: 10,
			shields: 9,
			agility: 5,
		},
		specs: [
			{ label: 'Engine', value: 'Dual Ion Reactors' },
			{ label: 'Hull', value: 'Reinforced Titanium Armour' },
			{ label: 'Shielding', value: 'Graviton Aegis' },
			{ label: 'Specialty', value: 'Impact Resistance' },
		],
		accentClass: 'accent-purple',
	},
}

export class ShipManager {
	constructor(scene) {
		this.scene = scene
		this.selectedKey = null
		this.currentModel = null
	}
	getConfig(key) {
		const config = SHIPS[key]
		if (!config) throw new Error(`Unknown spaceship key: "${key}"`)
		return config
	}
	getAllConfigs() {
		return Object.values(SHIPS)
	}
}
