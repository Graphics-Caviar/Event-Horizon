// engineVertex.glsl — Engine Core energy shader (vertex stage)
//
// This is a REFERENCE copy for the report/demo write-up. Because this
// project has no bundler (three.js loads from a CDN via an import map),
// browsers can't `import` a raw .glsl file directly — so the string that
// actually runs at runtime lives in ./engineShader.js as a JS template
// literal, byte-for-byte identical to this file. If you later add a
// bundler (Vite, webpack + glslify, etc.) this file can be imported
// directly instead and engineShader.js can re-export it.

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
