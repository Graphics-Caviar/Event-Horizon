import * as THREE from 'three'

/**
 * Lightweight comic-book post process used only by cinematic sequences.
 *
 * It intentionally avoids EffectComposer / three/examples so the cutscene
 * does not add another dependency to the Vite project. The gameplay scene is
 * rendered into a WebGLRenderTarget, then a fullscreen shader adds:
 *   - luminance-based ink outlines
 *   - posterized colour bands
 *   - screen-space halftone dots in darker regions
 *   - stronger contrast/saturation and a cinematic vignette
 *
 * `mix` can be animated from 0 -> 1 so a cutscene can move naturally from
 * normal Three.js rendering into the graphic-novel look and back again.
 */
export class ComicCutsceneRenderer {
	constructor(renderer) {
		this.renderer = renderer
		this.mix = 0
		this.time = 0
		this._disposed = false

		this.target = new THREE.WebGLRenderTarget(1, 1, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			depthBuffer: true,
			stencilBuffer: false,
		})
		this.target.texture.name = 'comic-cutscene-color'

		this.uniforms = {
			tDiffuse: { value: this.target.texture },
			uResolution: { value: new THREE.Vector2(1, 1) },
			uMix: { value: 0 },
			uTime: { value: 0 },
			uEdgeStrength: { value: 1.15 },
			uPosterizeLevels: { value: 5.0 },
			uHalftoneStrength: { value: 0.22 },
			uVignetteStrength: { value: 0.18 },
			uExposure: { value: 1.12 },
			uShadowLift: { value: 0.018 },
		}

		this.material = new THREE.ShaderMaterial({
			depthTest: false,
			depthWrite: false,
			uniforms: this.uniforms,
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				precision highp float;

				uniform sampler2D tDiffuse;
				uniform vec2 uResolution;
				uniform float uMix;
				uniform float uTime;
				uniform float uEdgeStrength;
				uniform float uPosterizeLevels;
				uniform float uHalftoneStrength;
				uniform float uVignetteStrength;
				uniform float uExposure;
				uniform float uShadowLift;
				varying vec2 vUv;

				float luma(vec3 c) {
					return dot(c, vec3(0.2126, 0.7152, 0.0722));
				}

				void main() {
					vec2 px = 1.0 / max(uResolution, vec2(1.0));
					vec3 source = texture2D(tDiffuse, vUv).rgb;
					vec3 base = clamp(source * uExposure + vec3(uShadowLift), 0.0, 1.0);

					float tl = luma(texture2D(tDiffuse, vUv + px * vec2(-1.0,  1.0)).rgb);
					float tc = luma(texture2D(tDiffuse, vUv + px * vec2( 0.0,  1.0)).rgb);
					float tr = luma(texture2D(tDiffuse, vUv + px * vec2( 1.0,  1.0)).rgb);
					float ml = luma(texture2D(tDiffuse, vUv + px * vec2(-1.0,  0.0)).rgb);
					float mr = luma(texture2D(tDiffuse, vUv + px * vec2( 1.0,  0.0)).rgb);
					float bl = luma(texture2D(tDiffuse, vUv + px * vec2(-1.0, -1.0)).rgb);
					float bc = luma(texture2D(tDiffuse, vUv + px * vec2( 0.0, -1.0)).rgb);
					float br = luma(texture2D(tDiffuse, vUv + px * vec2( 1.0, -1.0)).rgb);

					float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
					float gy =  tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
					float edge = smoothstep(0.08, 0.34, length(vec2(gx, gy)) * uEdgeStrength);

					float levels = max(2.0, uPosterizeLevels);
					// Lift mid/shadow values before quantisation. Posterising linear-space
					// values directly crushed this dark sci-fi scene almost to black.
					vec3 comicInput = pow(max(base, vec3(0.0)), vec3(0.76));
					vec3 comic = floor(comicInput * levels + 0.5) / levels;
					float grey = luma(comic);
					comic = mix(vec3(grey), comic, 1.22);
					comic = clamp((comic - 0.5) * 1.16 + 0.5, 0.0, 1.0);

					// Stable screen-space halftone. Darker pixels receive larger dots.
					vec2 dotUv = mod(gl_FragCoord.xy + vec2(uTime * 2.0, 0.0), 6.0) / 6.0 - 0.5;
					float darkness = 1.0 - luma(comic);
					float radius = mix(0.10, 0.47, darkness);
					float dotMask = 1.0 - smoothstep(radius - 0.06, radius + 0.03, length(dotUv));
					comic *= 1.0 - dotMask * darkness * uHalftoneStrength;

					// Near-black ink lines rather than absolute black so emissive FX survive.
					comic = mix(comic, vec3(0.018, 0.022, 0.032), edge * 0.92);

					vec2 centered = vUv - 0.5;
					centered.x *= uResolution.x / max(uResolution.y, 1.0);
					float vignette = smoothstep(0.34, 0.86, length(centered));
					comic *= 1.0 - vignette * uVignetteStrength;

					gl_FragColor = vec4(mix(base, comic, clamp(uMix, 0.0, 1.0)), 1.0);
					// Render targets are linear. Apply the same final display transform
					// Three.js normally performs when rendering a scene straight to screen.
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
		})

		this.screenScene = new THREE.Scene()
		this.screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
		this.quad.frustumCulled = false
		this.screenScene.add(this.quad)

		this.setSize()
	}

	setMix(value) {
		this.mix = THREE.MathUtils.clamp(value, 0, 1)
		this.uniforms.uMix.value = this.mix
	}

	setStyle({ edgeStrength, posterizeLevels, halftoneStrength, vignetteStrength, exposure, shadowLift } = {}) {
		if (Number.isFinite(edgeStrength)) this.uniforms.uEdgeStrength.value = edgeStrength
		if (Number.isFinite(posterizeLevels)) this.uniforms.uPosterizeLevels.value = posterizeLevels
		if (Number.isFinite(halftoneStrength)) this.uniforms.uHalftoneStrength.value = halftoneStrength
		if (Number.isFinite(vignetteStrength)) this.uniforms.uVignetteStrength.value = vignetteStrength
		if (Number.isFinite(exposure)) this.uniforms.uExposure.value = exposure
		if (Number.isFinite(shadowLift)) this.uniforms.uShadowLift.value = shadowLift
	}

	setSize() {
		if (this._disposed) return
		const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
		const width = Math.max(1, Math.floor(size.x))
		const height = Math.max(1, Math.floor(size.y))
		this.target.setSize(width, height)
		this.uniforms.uResolution.value.set(width, height)
	}

	update(delta) {
		this.time += Math.max(0, delta || 0)
		this.uniforms.uTime.value = this.time
	}

	render(scene, camera) {
		if (this._disposed) return
		const previousTarget = this.renderer.getRenderTarget()
		this.renderer.setRenderTarget(this.target)
		this.renderer.clear()
		this.renderer.render(scene, camera)
		this.renderer.setRenderTarget(previousTarget)
		this.renderer.render(this.screenScene, this.screenCamera)
	}

	dispose() {
		if (this._disposed) return
		this._disposed = true
		this.target.dispose()
		this.quad.geometry.dispose()
		this.material.dispose()
		this.screenScene.clear()
	}
}
