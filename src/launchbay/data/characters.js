/**
 * src/data/characters.js
 *
 * Single source of truth for pilot data. Nothing in this file knows about
 * Three.js, the DOM, or animation — it is pure data so that CharacterSystem,
 * CharacterCard, StatsPanel, etc. can all read from the same place without
 * coupling to each other.
 *
 * To add a new pilot: append an entry here and drop a matching GLB into
 * /public/models/. Everything downstream (cards, stats, model loading)
 * is driven by this list.
 */

export const CHARACTERS = [
	{
		id: 'zara',
		name: 'ZARA VOSS',
		role: 'THE ACE PILOT',

		// Path is relative to /public, resolved at runtime by CharacterModel.
		model: '/assets/models/pilots/zara-voss.glb',

		// Drives CSS custom properties (--theme-color) and shader/light tinting.
		themeColor: '#00bfff',
		themeColorDim: '#0a3a52',

		description:
			'A former military pilot with unmatched skills in high-speed maneuvers and survival.',

		stats: {
			speed: 90,
			firepower: 75,
			durability: 70,
			tech: 65,
			utility: 80,
		},

		abilities: [
			{
				id: 'afterburn',
				name: 'AFTERBURN',
				description: 'Short burst of extreme speed.',
				icon: 'afterburn', // maps to an icon id resolved in AbilityList
			},
			{
				id: 'precision-shot',
				name: 'PRECISION SHOT',
				description: 'Increased accuracy for weapons.',
				icon: 'precision-shot',
			},
			{
				id: 'evasive-roll',
				name: 'EVASIVE ROLL',
				description: 'Quick dodge in any direction.',
				icon: 'evasive-roll',
			},
		],

		// Camera framing used by CameraSystem when this pilot is focused/selected.
		cameraFraming: {
			idleOrbitRadius: 4.2,
			selectedOrbitRadius: 3.4,
			heightOffset: 1.3,
		},
	},

	{
		id: 'kai',
		name: 'KAI RYDER',
		role: 'THE SCAVENGER',

		model: '/assets/models/pilots/kai-ryder.glb',

		themeColor: '#3ddc84',
		themeColorDim: '#123b26',

		description:
			'A resourceful engineer who can make the most out of any situation.',

		stats: {
			speed: 60,
			firepower: 55,
			durability: 80,
			tech: 90,
			utility: 85,
		},

		abilities: [
			{
				id: 'salvage-expert',
				name: 'SALVAGE EXPERT',
				description:
					'Find more resources and ammunition.',
				icon: 'salvage-expert',
			},
			{
				id: 'repair-drone',
				name: 'REPAIR DRONE',
				description:
					'Deploy a drone that repairs your vehicle.',
				icon: 'repair-drone',
			},
			{
				id: 'hacker',
				name: 'HACKER',
				description:
					'Bypass systems and unlock restricted areas.',
				icon: 'hacker',
			},
		],

		cameraFraming: {
			idleOrbitRadius: 4.2,
			selectedOrbitRadius: 3.4,
			heightOffset: 1.2,
		},
	},

	{
		id: 'nyx',
		name: 'NYX',
		role: 'THE VOID WALKER',

		model: '/assets/models/pilots/nyx.glb',

		themeColor: '#9b5cff',
		themeColorDim: '#2c1a4d',

		description:
			'A mysterious figure with the ability to manipulate gravity and phase through danger.',

		stats: {
			speed: 70,
			firepower: 65,
			durability: 60,
			tech: 80,
			utility: 95,
		},

		abilities: [
			{
				id: 'gravity-shift',
				name: 'GRAVITY SHIFT',
				description:
					'Manipulate gravity to your advantage.',
				icon: 'gravity-shift',
			},
			{
				id: 'phase-step',
				name: 'PHASE STEP',
				description:
					'Short teleport through obstacles.',
				icon: 'phase-step',
			},
			{
				id: 'void-shield',
				name: 'VOID SHIELD',
				description:
					'Become intangible for a short time.',
				icon: 'void-shield',
			},
		],

		cameraFraming: {
			idleOrbitRadius: 4.4,
			selectedOrbitRadius: 3.5,
			heightOffset: 1.35,
		},
	},
]

/** Stat keys, in the display order used by StatsPanel's horizontal bars. */
export const STAT_KEYS = ['speed', 'firepower', 'durability', 'tech', 'utility']

export const STAT_LABELS = {
	speed: 'SPEED',
	firepower: 'FIREPOWER',
	durability: 'DURABILITY',
	tech: 'TECH',
	utility: 'UTILITY',
}

export function getCharacterById(id) {
	return CHARACTERS.find((c) => c.id === id) ?? null
}
