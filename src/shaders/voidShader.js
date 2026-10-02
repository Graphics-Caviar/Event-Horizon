import * as THREE from 'three'

// Live version of voidVertex.glsl / voidFragment.glsl — see the note at
// the top of engineShader.js for why this is duplicated as a JS string,
// and note it is kept byte-for-byte identical (comments included).

export const voidVertexShader = /* glsl */ `
uniform float uTime;
uniform float uIntensity;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vDisplacement;

void main() {
  vNormal = normalize(normalMatrix * normal);

  // A stronger, lower-frequency distortion than the engine shader — meant
  // to read as a warping gravity field rather than a contained plasma.
  float displacement = sin(uTime * 2.0 + position.x * 3.0 + position.y * 3.0) * 0.12 * uIntensity;
  vDisplacement = displacement;
  vec3 displaced = position + normal * displacement;

  vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
  vViewPosition = -viewPosition.xyz;

  gl_Position = projectionMatrix * viewPosition;
}
`

export const voidFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vDisplacement;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 1.6);

  // Use the vertex displacement itself to drive brightness, so the parts
  // of the surface that are warping outward glow brighter — ties the
  // fragment colour directly to the vertex-stage distortion.
  float warpGlow = 0.5 + vDisplacement * 2.0;

  vec3 finalColor = uColor * (fresnel * 1.8 + warpGlow) * uIntensity;
  float alpha = clamp(fresnel + 0.25, 0.0, 1.0) * uIntensity;

  gl_FragColor = vec4(finalColor, alpha);
}
`

export function createVoidMaterial(color = 0xa86bff) {
	return new THREE.ShaderMaterial({
		vertexShader: voidVertexShader,
		fragmentShader: voidFragmentShader,
		uniforms: {
			uTime: { value: 0 },
			uColor: { value: new THREE.Color(color) },
			uIntensity: { value: 1.0 },
		},
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	})
}
