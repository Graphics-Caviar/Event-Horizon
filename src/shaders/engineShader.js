import * as THREE from 'three'

// Live version of engineVertex.glsl / engineFragment.glsl. Kept truly
// byte-for-byte identical (comments included) to the .glsl reference
// files — see the note at the top of engineVertex.glsl for why the
// source lives here as a JS string rather than being imported directly
// (no bundler in this project, so browsers can't `import` raw .glsl).

export const engineVertexShader = /* glsl */ `
uniform float uTime;
uniform float uIntensity;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  // Pass the normal through in view space so the fragment shader can
  // build a fresnel (edge-brightening) term without redoing the matrix
  // multiply per-fragment.
  vNormal = normalize(normalMatrix * normal);

  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -viewPosition.xyz;

  // Small time-based outward displacement along the vertex normal, so the
  // engine core visibly "breathes" rather than just changing colour. The
  // displacement amount is tied to uIntensity so it grows during a boost.
  float pulse = sin(uTime * 4.0 + position.y * 6.0) * 0.04 * uIntensity;
  vec3 displaced = position + normal * pulse;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`

export const engineFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);

  // Fresnel term: faces pointing toward the camera are dim, edges (where
  // the surface normal is near-perpendicular to the view direction) are
  // bright. This is what makes the core look like glowing contained
  // energy rather than a flat-lit sphere.
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.2);

  // Layered sine waves standing in for "cheap noise" — three offset
  // frequencies summed together read as a churning plasma pattern
  // without needing a noise texture. Purely a function of uTime, so the
  // whole effect animates for free once uTime is updated each frame.
  float swirl =
      sin(uTime * 3.0 + vNormal.x * 10.0) * 0.5 +
      sin(uTime * 5.0 + vNormal.y * 14.0) * 0.3 +
      sin(uTime * 7.0 + vNormal.z * 8.0) * 0.2;
  swirl = swirl * 0.5 + 0.5; // remap from [-1,1] to [0,1]

  vec3 core = uColor * (0.6 + swirl * 0.6) * uIntensity;
  vec3 rim = uColor * fresnel * 2.0 * uIntensity;

  vec3 finalColor = core + rim;
  gl_FragColor = vec4(finalColor, 1.0);
}
`

/**
 * Creates a ShaderMaterial for an engine core. `uIntensity` should be
 * updated each frame (e.g. driven by throttle) by whoever owns the
 * material — see Spaceship.js's update() for the pattern.
 */
export function createEngineCoreMaterial(color = 0x4de3ff) {
	return new THREE.ShaderMaterial({
		vertexShader: engineVertexShader,
		fragmentShader: engineFragmentShader,
		uniforms: {
			uTime: { value: 0 },
			uColor: { value: new THREE.Color(color) },
			uIntensity: { value: 1.0 },
		},
		transparent: false,
	})
}
