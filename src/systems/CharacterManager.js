/**
 * Character configuration for the pilot selection screen.
 * Each character points to the real GLB in the repo. A remote fallback is
 * included so older ZIP snapshots still work while the assets are on main.
 */
export const CHARACTERS = {
	zara: {
		key: 'zara',
		name: 'Zara Voss',
		role: 'The Ace Pilot',
		description:
			'A former military pilot with unmatched skills in high-speed maneuvers and survival.',
		model: [
			'/assets/models/pilots/zara-voss.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/pilots/zara-voss.glb',
		],
		stats: {
			speed: 9,
			firepower: 6,
			durability: 6,
			tech: 5,
			utility: 5,
		},
		abilities: [
			{
				id: 'afterburn',
				name: 'Afterburn',
				description: 'Short burst of extreme speed.',
			},
			{
				id: 'precisionShot',
				name: 'Precision Shot',
				description: 'Increased accuracy for weapons.',
			},
			{
				id: 'evasiveRoll',
				name: 'Evasive Roll',
				description: 'Quick dodge in any direction.',
			},
		],
		colorTheme: 0x4de3ff,
	},
	kai: {
		key: 'kai',
		name: 'Kai Ryder',
		role: 'The Scavenger',
		description:
			'A resourceful engineer who can make the most out of any situation.',
		model: [
			'/assets/models/pilots/kai-ryder.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/pilots/kai-ryder.glb',
		],
		stats: {
			speed: 6,
			firepower: 5,
			durability: 8,
			tech: 9,
			utility: 8,
		},
		abilities: [
			{
				id: 'salvageExpert',
				name: 'Salvage Expert',
				description: 'Find more resources and ammo.',
			},
			{
				id: 'repairDrone',
				name: 'Repair Drone',
				description:
					'Deploy a drone that repairs your vehicle.',
			},
			{
				id: 'hacker',
				name: 'Hacker',
				description:
					'Bypass systems and unlock restricted areas.',
			},
		],
		colorTheme: 0x7dffa0,
	},
	nyx: {
		key: 'nyx',
		name: 'Nyx',
		role: 'The Void Walker',
		description:
			'A mysterious figure with the ability to manipulate gravity and phase through danger.',
		model: [
			'/assets/models/pilots/nyx.glb',
			'https://raw.githubusercontent.com/Graphics-Caviar/Event-Horizon/main/public/assets/models/pilots/nyx.glb',
		],
		stats: {
			speed: 8,
			firepower: 4,
			durability: 5,
			tech: 10,
			utility: 7,
		},
		abilities: [
			{
				id: 'gravityShift',
				name: 'Gravity Shift',
				description:
					'Manipulate gravity to your advantage.',
			},
			{
				id: 'phaseStep',
				name: 'Phase Step',
				description:
					'Short teleport through obstacles.',
			},
			{
				id: 'voidShield',
				name: 'Void Shield',
				description:
					'Become intangible for a short time.',
			},
		],
		colorTheme: 0xa86bff,
	},
}

export class CharacterManager {
	constructor(scene, assetManager) {
		this.scene = scene
		this.assetManager = assetManager
		this.selectedKey = null
		this.currentModel = null
	}

	getConfig(key) {
		const config = CHARACTERS[key]
		if (!config) throw new Error(`Unknown character key: "${key}"`)
		return config
	}

	getAllConfigs() {
		return Object.values(CHARACTERS)
	}

	async select(key) {
		const config = this.getConfig(key)
		this.removeCurrent()
		const model = await this.assetManager.loadModel(config.model)
		this.currentModel = model
		this.selectedKey = key
		this.scene.add(model)
		return model
	}

	removeCurrent() {
		if (this.currentModel?.parent)
			this.currentModel.parent.remove(this.currentModel)
		this.currentModel = null
	}

	getSelectedConfig() {
		return this.selectedKey
			? this.getConfig(this.selectedKey)
			: null
	}

	dispose() {
		this.removeCurrent()
		this.selectedKey = null
	}
}
