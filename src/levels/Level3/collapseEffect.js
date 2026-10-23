// Shared world-space breakup for terrain, mountains, instanced crystals and ruins.
// The source mesh stays visible as it falls; only deeply fallen material is retired.
export function installCollapseEffect(material, survival) {
	const previous = material.onBeforeCompile
	const key = material.customProgramCacheKey
	material.onBeforeCompile = function (shader, renderer) {
		previous.call(this, shader, renderer)
		Object.assign(shader.uniforms, {
			collapseEdge: survival.uniform,
			collapseTime: survival.timeUniform,
			collapseTremor: survival.tremorUniform,
			collapseStart: { value: survival.start },
			collapseDirection: { value: survival.direction },
			collapseExit: { value: survival.end },
			collapseSpeed: {
				value:
					(survival.length + 70) /
					survival.config.collapseSeconds,
			},
		})
		const declarations = `
uniform float collapseEdge, collapseTime, collapseTremor, collapseSpeed;
uniform vec3 collapseStart, collapseDirection, collapseExit;
varying vec3 vCollapseWorld;
varying float vFallAge, vInstability;
`
		shader.vertexShader = declarations + shader.vertexShader
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			`
#include <begin_vertex>
mat4 collapseMatrix = modelMatrix;
#ifdef USE_INSTANCING
collapseMatrix = modelMatrix * instanceMatrix;
#endif
vCollapseWorld = (collapseMatrix * vec4(transformed, 1.0)).xyz;
vec2 cell = floor(vCollapseWorld.xz / 12.0);
float offset = sin(cell.x * 1.7 + cell.y * 2.3) * 8.0;
float ahead = dot(vCollapseWorld.xz - collapseStart.xz, collapseDirection.xz) - collapseEdge - offset;
float safe = smoothstep(28.0, 36.0, distance(vCollapseWorld.xz, collapseExit.xz));
vFallAge = max(0.0, -ahead / collapseSpeed) * safe;
vInstability = max(collapseTremor, 1.0 - smoothstep(0.0, 24.0, abs(ahead))) * safe;
float fall = min(1800.0, 1.5 * vFallAge + 4.9 * vFallAge * vFallAge);
// World-down projected into local coordinates also handles rotated/scaled props.
vec3 down = vec3(collapseMatrix[0].y, collapseMatrix[1].y, collapseMatrix[2].y);
vec3 scales = vec3(dot(collapseMatrix[0].xyz, collapseMatrix[0].xyz), dot(collapseMatrix[1].xyz, collapseMatrix[1].xyz), dot(collapseMatrix[2].xyz, collapseMatrix[2].xyz));
transformed += down / max(scales, vec3(0.0001)) * (-fall + sin(collapseTime * 37.0 + cell.x * 7.0 + cell.y) * vInstability * 0.16);
`
		)
		shader.fragmentShader = declarations + shader.fragmentShader
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <clipping_planes_fragment>',
			`
#include <clipping_planes_fragment>
float collapseDistance = dot(vCollapseWorld.xz - collapseStart.xz, collapseDirection.xz) - collapseEdge;
// Let fragments visibly descend for ten seconds before retiring them below the world.
if (vFallAge > 10.0) discard;
vec2 crackCell = abs(fract(vCollapseWorld.xz / 12.0) - 0.5);
float crack = smoothstep(0.465, 0.499, max(crackCell.x, crackCell.y));
if (vFallAge > 0.2 && crack > 0.96) discard;
`
		)
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <opaque_fragment>',
			`
outgoingLight *= 1.0 - crack * vInstability * 0.85;
outgoingLight += vec3(0.35, 0.06, 0.015) * crack * vInstability;
#include <opaque_fragment>
`
		)
	}
	material.customProgramCacheKey = () =>
		`${key.call(material)}-falling-fractures-v1`
	material.needsUpdate = true
	return () => {
		material.onBeforeCompile = previous
		material.customProgramCacheKey = key
		material.needsUpdate = true
	}
}
