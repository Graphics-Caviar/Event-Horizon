// voidFragment.glsl — see voidVertex.glsl and engineFragment.glsl for
// context. Reference copy; voidShader.js has the live source.

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
