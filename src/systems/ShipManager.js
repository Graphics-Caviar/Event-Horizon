/**
 * ShipManager.js
 * Configuration data and manager for player spaceships.
 * Keeps data cleanly decoupled from Three.js rendering.
 */

export const SHIPS = {
	raven: {
		key: 'raven',
		name: 'Orbital Raven',
		mark: 'MK VII',
		role: 'Strike Fighter',
		tagline: '"Built for the impossible."',
		description:
			'A versatile vanguard fighter built for rapid atmospheric exit and high-G combat maneuvers near gravity hazards.',
		stats: {
			speed: 8,
			firepower: 7,
			durability: 7,
			shields: 8,
			agility: 9,
		},
		specs: [
			{ label: 'Engine', value: 'Twin Ion Thrusters' },
			{ label: 'Hull', value: 'Titanium Composite' },
			{ label: 'Shielding', value: 'Quantum Energy Shield' },
			{ label: 'Specialty', value: 'Balanced Vectoring' },
		],
		colors: {
			hull: 0xd7dde4,
			panel: 0x565f6b,
			cockpit: 0x08131c,
			engineHousing: 0x2b2f36,
			engineGlow: 0x4de3ff,
			gearMetal: 0x3a3f47,
		},
		accentClass: 'accent-cyan',
	},
	phantom: {
		key: 'phantom',
		name: 'Solar Phantom',
		mark: 'EX-04',
		role: 'Stealth Interceptor',
		tagline: '"Strike like lightning, vanish like dust."',
		description:
			'Equipped with radar-dampening carbon weave and supercharged plasma burners for extreme escape velocity.',
		stats: {
			speed: 10,
			firepower: 6,
			durability: 5,
			shields: 6,
			agility: 10,
		},
		specs: [
			{ label: 'Engine', value: 'Hyper-Plasma Burners' },
			{ label: 'Hull', value: 'Carbon Weave Armor' },
			{ label: 'Shielding', value: 'Phase Barrier' },
			{ label: 'Specialty', value: 'Extreme Overdrive' },
		],
		colors: {
			hull: 0x22262d,
			panel: 0xd49b38,
			cockpit: 0x1f1708,
			engineHousing: 0x181c22,
			engineGlow: 0xffaa33,
			gearMetal: 0x2e2f33,
		},
		accentClass: 'accent-gold',
	},
	interceptor: {
		key: 'interceptor',
		name: 'Void Reaper',
		mark: 'V-PROTOTYPE',
		role: 'Heavy Assault',
		tagline: '"Forged in the dark between stars."',
		description:
			'Reinforced heavy combat frame harnessing dark energy singularity siphons and obsidian reactive plating.',
		stats: {
			speed: 6,
			firepower: 10,
			durability: 9,
			shields: 9,
			agility: 6,
		},
		specs: [
			{ label: 'Engine', value: 'Dark Energy Siphon' },
			{ label: 'Hull', value: 'Obsidian Reactive Plates' },
			{ label: 'Shielding', value: 'Graviton Aegis' },
			{ label: 'Specialty', value: 'Singularity Resistance' },
		],
		colors: {
			hull: 0x181522,
			panel: 0x6e3ba7,
			cockpit: 0x150924,
			engineHousing: 0x1d142b,
			engineGlow: 0xa86bff,
			gearMetal: 0x272036,
		},
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
