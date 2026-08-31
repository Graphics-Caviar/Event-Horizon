// engineFragment.glsl — Engine Core energy shader (fragment stage)
// See the note at the top of engineVertex.glsl about why this is a
// reference copy — the live version is the string in ./engineShader.js.

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
