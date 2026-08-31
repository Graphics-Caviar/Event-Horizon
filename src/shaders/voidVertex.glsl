// voidVertex.glsl — Void energy shader used for Nyx's ability effects
// (Gravity Shift / Phase Step / Void Shield). Reference copy — see the
// note in engineVertex.glsl about why the live source lives in
// voidShader.js instead of being imported directly.

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
