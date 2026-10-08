import * as THREE from 'three'

export function clearScene(scene) {
	while (scene.children.length > 0) {
		const object = scene.children[0]

		object.traverse((child) => {
			// Models returned by AssetManager clone the scene graph but share the
			// cache's geometry/material/texture resources. Removing the instance is
			// enough; disposing those shared resources would corrupt later clones.
			if (child.userData?.__assetManagerShared) return

			if (child.geometry) {
				child.geometry.dispose()
			}

			if (child.material) {
				const materials = Array.isArray(child.material)
					? child.material
					: [child.material]

				for (const material of materials) {
					disposeMaterial(material)
				}
			}
		})

		scene.remove(object)
	}
}

function disposeMaterial(material) {
	for (const key in material) {
		const value = material[key]

		if (value?.isTexture) {
			value.dispose()
		}
	}

	material.dispose()
}

export class Level {
	constructor(game, level) {
		this.game = game
		this.level = level
		this.game.gameState.currentLevel = level

		this.sceneManager = game.sceneManager
		this.assetManager = game.assetManager

		this.objects = []
		this.resources = new Set()
	}

	addObject(object) {
		this.objects.push(object)
		this.game.sceneManager.scene.add(object)
		return object
	}

	own(resource) {
		this.resources.add(resource)
		return resource
	}

	dispose() {
		for (const object of this.objects) {
			object.removeFromParent()
		}
		for (const resource of this.resources) {
			resource.dispose()
		}

		this.objects = []
		this.resources.clear()
	}

	update(delta) {}
}
