import * as THREE from 'three';
/** The look pass for entity (god) worlds — presentation only, deterministic for shots (no time, no randomness):
 *
 *  1. Ambient occlusion: the scene is drawn into a multisampled target with a depth texture; a half-resolution
 *     screen-space pass (12 samples on a fixed per-pixel spiral, normals rebuilt from depth) and a depth-aware blur
 *     darken creases, contact lines and inner corners; a composite multiplies it in and writes the canvas. The target
 *     is flagged like an XR target so three draws into it exactly as into the canvas (tone mapping, sRGB, the fog
 *     chunk's display-space grade): the picture is unchanged except for the occlusion.
 *  2. Highlight roll-off and night exposure: a custom per-channel tone curve that is the identity below 0.8 (so the
 *     day look is unchanged) with a soft shoulder above (instead of a hard clip), and an exposure that rises at night so moonlit builds and warm lamp
 *     pools read instead of sinking to black (the sky dome is not tone mapped, so night stays night).
 *  3. Material detail: world-space value noise mottles albedo (strongest on up-facing ground: large soft patches)
 *     and adds a faint bump to lit surfaces; shiny, transparent and glowing surfaces are left alone.
 *
 *  `?look=flat` turns all of it off, `?post=0` only the occlusion pass, `?detail=0` only the material detail. The
 *  phone tier keeps the old direct draw (no extra targets) and no material detail; the tone curve applies everywhere. */
export type LookSettings = { enabled: boolean; ao: boolean; detail: number; follow: boolean; nightExposure: number; poolGain: number };
/** Tuning dials for shots (`?nightx=`, `?poolgain=`); a bad value keeps the default. */
const num = (v: string | null, d: number) => { const n = v === null ? NaN : Number(v); return Number.isFinite(n) && n > 0 && n < 8 ? n : d; };
export function lookSettings(search: string, tier: 'phone' | 'full', entityWorld: boolean): LookSettings {
  const q = new URLSearchParams(search), on = entityWorld && q.get('look') !== 'flat';
  return { enabled: on, ao: on && tier === 'full' && q.get('post') !== '0', detail: on && tier === 'full' && q.get('detail') !== '0' ? 1 : 0, follow: on, nightExposure: on ? num(q.get('nightx'), 1.4) : 1, poolGain: on ? num(q.get('poolgain'), 1.4) : 1 }; // W2 darker night (were 1.85 / 1.7)
}
/** Exposure for daylight 0 (night) .. 1 (day); null (no clock yet) is day. */
export function lookExposure(daylight: number | null, night: number): number {
  const d = daylight === null || !Number.isFinite(daylight) ? 1 : Math.max(0, Math.min(1, daylight));
  const t = Math.max(0, Math.min(1, d / 0.6)), day = t * t * (3 - 2 * t);
  return night + (1 - night) * day;
}

// ------------------------------------------------------------------ sun shadow box that follows the view
/** The sun's shadow box for a camera (Daylight.follow): centre = the orbit target, half-size from the eye distance in
 *  8 m steps (24..160 m), centre snapped to whole shadow texels (a still camera gives the same shadow every frame), PCF
 *  disk radius about 18 cm of ground (1.25..3.5 texels), normal offset two texels. null for a non-finite camera. */
export function shadowFollowBox(target: { x: number; y: number; z: number }, eye: { x: number; y: number; z: number }, mapSize: number) {
  const dist = Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z);
  if (!Number.isFinite(dist) || ![target.x, target.y, target.z].every(Number.isFinite) || !(mapSize > 0)) return null;
  const half = Math.max(24, Math.min(160, Math.ceil((dist * 0.9 + 12) / 8) * 8)), texel = (2 * half) / mapSize;
  const cx = Math.round(target.x / texel) * texel, cz = Math.round(target.z / texel) * texel, cy = Math.round(target.y);
  return { half, cx, cy, cz, texel, radius: Math.max(1.25, Math.min(3.5, 0.18 / texel)), normalBias: Math.max(0.05, 2 * texel), key: `${half}|${cx}|${cy}|${cz}|${mapSize}` };
}

// ------------------------------------------------------------------ daylight shadow filtering
/** Three r185 uses five rotated hardware-PCF samples. On tilted textured panels
 * those sparse samples cross shadow-map texels as daylight moves, producing large
 * pixel jumps even with a fixed camera. Keep the same footprint, bias and moving
 * sun, but integrate it with sixteen samples on full-size maps. Phone maps retain
 * the original five samples. This changes only directional/spot PCF, not point,
 * basic or variance shadows. */
export function stableShadowPCF(chunk: string): string {
  if (chunk.includes('int edenSample = 0')) return chunk;
  const start = chunk.indexOf('float getShadow( sampler2DShadow');
  const begin = chunk.indexOf('shadow = (', start);
  const end = chunk.indexOf(') * 0.2;', begin);
  if (start < 0 || begin < start || end < begin) return chunk;
  const sparse = chunk.slice(begin, end + ') * 0.2;'.length);
  // Fail closed if a Three upgrade changes the sampling contract; do not replace
  // another shadow algorithm merely because it has a similarly named function.
  if (!sparse.includes('vogelDiskSample( 4, 5, phi )') || sparse.split('texture( shadowMap').length !== 6) return chunk;
  const dense = `if ( shadowMapSize.x >= 2048.0 ) {
                  shadow = 0.0;
                  for ( int edenSample = 0; edenSample < 16; edenSample ++ ) {
                    shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( edenSample, 16, phi ) * radius, shadowCoord.z ) );
                  }
                  shadow *= 0.0625;
                } else {
                  ${sparse}
                }`;
  return chunk.slice(0, begin) + dense + chunk.slice(end + ') * 0.2;'.length);
}
let shadowFilterInstalled = false;
export function installStableShadowFilter() {
  if (shadowFilterInstalled) return;
  shadowFilterInstalled = true;
  THREE.ShaderChunk.shadowmap_pars_fragment = stableShadowPCF(THREE.ShaderChunk.shadowmap_pars_fragment);
}

// ------------------------------------------------------------------ the cached sun shadow (SunShadowCache)
const SUN_SHADOW_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const SUN_SHADOW_BLOCK = `#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		${SUN_SHADOW_LINE}
		#endif`;
/** Lane PERF-BAKED-SHADOWS: with exactly two shadow-casting directional lights, the second is the sun's cached map of
 *  still things (Daylight.baked: no light of its own). The sun (light 0) is shadowed by the darker of its per-frame map
 *  (what moves) and the cached one, through the same PCF; light 1 takes no shadow lookup. Every other light count keeps
 *  three's loop unchanged. Fails closed (unchanged chunk) if a Three upgrade changes the loop. */
export function bakedSunShadowChunk(chunk: string): string {
  if (chunk.includes('EDEN_BAKED_SUN') || !chunk.includes(SUN_SHADOW_BLOCK)) return chunk;
  const cached = 'getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] )';
  const both = SUN_SHADOW_LINE.replace(/\? (getShadow\( directionalShadowMap\[ i \][^;]*\)) : 1\.0;$/, `? min( $1, ${cached} ) : 1.0;`);
  return chunk.replace(SUN_SHADOW_BLOCK, `#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS == 2 && UNROLLED_LOOP_INDEX == 0 /* EDEN_BAKED_SUN */
		directionalLightShadow = directionalLightShadows[ i ];
		${both}
		#elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS ) && NUM_DIR_LIGHT_SHADOWS != 2
		directionalLightShadow = directionalLightShadows[ i ];
		${SUN_SHADOW_LINE}
		#endif`);
}
/** True once the lights chunk combines the two sun maps (Daylight creates the cached map only then). */
export function installBakedSunShadow(): boolean {
  THREE.ShaderChunk.lights_fragment_begin = bakedSunShadowChunk(THREE.ShaderChunk.lights_fragment_begin);
  return THREE.ShaderChunk.lights_fragment_begin.includes('EDEN_BAKED_SUN');
}

// ------------------------------------------------------------------ tone curve (CustomToneMapping)
const TONE_GLSL = /* glsl */`vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	// per channel, like the clip it replaces (saturated neon stays saturated), but a soft shoulder from 0.8 up
	vec3 over = max( color - 0.8, 0.0 );
	return min( color, vec3( 0.8 ) ) + 0.2 * ( 1.0 - exp( - over / 0.2 ) );
}`;
let toneInstalled = false;
/** Patch three's CustomToneMapping once, before programs compile (harmless while the renderer uses another curve). */
export function installLookToneCurve() {
  if (toneInstalled) return; toneInstalled = true;
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment, stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (chunk.includes(stub)) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, TONE_GLSL);
}

// ------------------------------------------------------------------ material detail (shared chunk patch)
/** x strength (0 off), y ground patch strength, z fine mottle strength, w bump strength. Shared by reference. */
const DETAIL = { x: 0, y: 0.10, z: 0.07, w: 0.55 };
const DETAIL_GLSL = /* glsl */`
#if defined( EDEN_DETAIL_PARS ) && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON ) )
if ( uEdenDetail.x > 0.0 ) {
	#if defined( STANDARD )
	float edenRough = roughnessFactor;
	#else
	float edenRough = 1.0;
	#endif
	float edenGlow = max( totalEmissiveRadiance.r, max( totalEmissiveRadiance.g, totalEmissiveRadiance.b ) );
	float edenAmt = uEdenDetail.x * smoothstep( 0.3, 0.7, edenRough ) * step( 0.98, diffuseColor.a ) * ( 1.0 - smoothstep( 0.15, 0.6, edenGlow ) );
	if ( edenAmt > 0.0 ) {
		vec3 edenP = vEdenNightWorld;
		vec3 edenN = inverseTransformDirection( normal, viewMatrix );
		float edenUp = smoothstep( 0.55, 0.92, edenN.y );
		float edenFine = edenNoise( edenP * 2.7 ), edenMid = edenNoise( edenP * 0.8 + 17.0 );
		float edenM = ( edenFine * 0.45 + edenMid * 0.55 ) - 0.5;
		float edenPatch = edenNoise( edenP * vec3( 0.16, 0.5, 0.16 ) + 41.0 ) - 0.5;
		diffuseColor.rgb *= 1.0 + edenAmt * ( 2.0 * uEdenDetail.z * edenM + edenUp * 2.0 * uEdenDetail.y * edenPatch );
		// ground patches drift a touch warmer/cooler, as dry and lush ground do
		diffuseColor.rgb *= 1.0 + edenAmt * edenUp * edenPatch * vec3( 0.06, 0.0, -0.06 );
		// a faint bump from the fine noise's gradient (finite differences, world space, tangent to the face)
		vec3 edenG = vec3( edenNoise( ( edenP + vec3( 0.07, 0.0, 0.0 ) ) * 2.7 ), edenNoise( ( edenP + vec3( 0.0, 0.07, 0.0 ) ) * 2.7 ), edenNoise( ( edenP + vec3( 0.0, 0.0, 0.07 ) ) * 2.7 ) ) - edenFine;
		edenG -= dot( edenG, edenN ) * edenN;
		vec3 edenBent = normalize( edenN - edenAmt * uEdenDetail.w * edenG );
		normal = normalize( ( viewMatrix * vec4( edenBent, 0.0 ) ).xyz );
	}
}
#endif
`;
const NOISE_GLSL = /* glsl */`
#define EDEN_DETAIL_PARS
uniform vec4 uEdenDetail;
float edenHash( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
float edenNoise( vec3 p ) {
	vec3 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( edenHash( i ), edenHash( i + vec3( 1, 0, 0 ) ), u.x ), mix( edenHash( i + vec3( 0, 1, 0 ) ), edenHash( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
		mix( mix( edenHash( i + vec3( 0, 0, 1 ) ), edenHash( i + vec3( 1, 0, 1 ) ), u.x ), mix( edenHash( i + vec3( 0, 1, 1 ) ), edenHash( i + vec3( 1, 1, 1 ) ), u.x ), u.y ), u.z );
}
`;
let detailInstalled = false;
/** Patch the lit materials' shared chunks once (after installNightLighting, whose world-position varying it reads). */
export function installMaterialDetail() {
  if (detailInstalled) return; detailInstalled = true;
  THREE.ShaderChunk.lights_pars_begin += NOISE_GLSL;
  THREE.ShaderChunk.normal_fragment_maps += DETAIL_GLSL;
  for (const name of ['lambert', 'phong', 'standard', 'physical', 'toon'] as const) { const lib = THREE.ShaderLib[name]; if (lib) lib.uniforms.uEdenDetail = { value: DETAIL }; }
}
export function setMaterialDetail(k: number) { DETAIL.x = Math.max(0, Math.min(1, k)); }

// ------------------------------------------------------------------ ambient occlusion pass
const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
const DEPTH_GLSL = /* glsl */`
uniform highp sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uDepthSize;
vec3 edenView( vec2 uv, float d ) { vec4 v = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); return v.xyz / v.w; }
// the view-space point of the depth texel under uv, rebuilt at that texel's own centre (rebuilding at uv itself puts
// grazing ground off its plane by up to half a texel of depth: striped self-occlusion)
vec3 edenViewAt( vec2 uv, out float d ) { uv = ( floor( uv * uDepthSize ) + 0.5 ) / uDepthSize; d = texture2D( tDepth, uv ).x; return edenView( uv, d ); }
`;
const AO_FRAG = /* glsl */`
${DEPTH_GLSL}
uniform vec2 uTexel; uniform vec2 uProjScale; uniform float uRadius; uniform float uIntensity; uniform float uFadeFar;
varying vec2 vUv;
const int SAMPLES = 12;
void main() {
	float d, dn;
	vec3 P = edenViewAt( vUv, d );
	if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }
	vec2 dx = vec2( uTexel.x, 0.0 ), dy = vec2( 0.0, uTexel.y );
	vec3 Pr = edenViewAt( vUv + dx, dn ), Pl = edenViewAt( vUv - dx, dn ), Pu = edenViewAt( vUv + dy, dn ), Pd = edenViewAt( vUv - dy, dn );
	vec3 ex = abs( Pr.z - P.z ) < abs( P.z - Pl.z ) ? Pr - P : P - Pl;
	vec3 ey = abs( Pu.z - P.z ) < abs( P.z - Pd.z ) ? Pu - P : P - Pd;
	vec3 N = normalize( cross( ex, ey ) );
	float z = -P.z;
	vec2 scale = uRadius * uProjScale / z;            // the world radius in uv at this depth
	float px = scale.x / uTexel.x;                     // ... in (half-resolution) pixels
	if ( px < 1.5 ) { gl_FragColor = vec4( 1.0 ); return; }
	scale *= min( 1.0, 48.0 / px );                    // bound the footprint close up (cache and cost)
	float R2 = uRadius * uRadius;
	// a 4×4 interleaved rotation (Bayer order), which the 4×4 blur removes exactly: no noise pattern survives
	ivec2 cell = ivec2( mod( gl_FragCoord.xy, 4.0 ) );
	float k = float( ( ( cell.x & 1 ) ^ ( cell.y & 1 ) ) * 8 + ( cell.y & 1 ) * 4 + ( ( cell.x >> 1 ) ^ ( cell.y >> 1 ) ) * 2 + ( cell.y >> 1 ) );
	float phi = ( k + 0.5 ) / 16.0 * 6.2831853;
	float jitter = fract( k * 0.618034 );
	float occ = 0.0;
	for ( int i = 0; i < SAMPLES; i ++ ) {
		float t = ( float( i ) + jitter ) / float( SAMPLES ), a = phi + float( i ) * 2.3999632;
		vec2 suv = vUv + vec2( cos( a ), sin( a ) ) * scale * t;
		float sd;
		vec3 v = edenViewAt( suv, sd ) - P;
		if ( sd >= 0.99999 ) continue;
		float vv = dot( v, v );
		float falloff = max( 0.0, 1.0 - vv / R2 );
		occ += falloff * max( 0.0, dot( v, N ) * inversesqrt( vv + 1e-4 ) - 0.12 );
	}
	float ao = 1.0 - uIntensity * occ / float( SAMPLES );
	ao = mix( clamp( ao, 0.0, 1.0 ), 1.0, smoothstep( uFadeFar * 0.55, uFadeFar, z ) );
	gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;
const BLUR_FRAG = /* glsl */`
${DEPTH_GLSL}
uniform sampler2D tAo; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
	float dn, z = -edenViewAt( vUv, dn ).z;
	float sum = 0.0, wsum = 0.0;
	for ( int j = -2; j <= 1; j ++ ) for ( int i = -2; i <= 1; i ++ ) {
		vec2 uv = vUv + vec2( float( i ), float( j ) ) * uTexel;
		float sz = -edenViewAt( uv, dn ).z;
		float w = 1.0 / ( 1e-3 + abs( sz - z ) / max( z, 1e-3 ) * 40.0 );
		sum += texture2D( tAo, uv ).r * w; wsum += w;
	}
	float ao = sum / max( wsum, 1e-5 );
	gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;
const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tColor; uniform sampler2D tAo; uniform float uStrength; uniform float uDebug;
varying vec2 vUv;
void main() {
	vec4 c = texture2D( tColor, vUv );
	float ao = texture2D( tAo, vUv ).r;
	gl_FragColor = uDebug > 0.5 ? vec4( vec3( ao ), 1.0 ) : vec4( c.rgb * mix( 1.0, ao, uStrength ), 1.0 );
}`;

/** One per live view. render() replaces renderer.render(scene, camera) for the main picture. */
export class WorldPost {
  private readonly size = new THREE.Vector2();
  private target: THREE.WebGLRenderTarget | null = null;
  private aoTarget: THREE.WebGLRenderTarget | null = null;
  private blurTarget: THREE.WebGLRenderTarget | null = null;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.Camera();
  private readonly ao: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  /** Occlusion radius (m), intensity, composite strength, fade distance (m). */
  readonly params = { radius: 1.4, intensity: 2.0, strength: 0.65, fadeFar: 170 };
  failed = false;
  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    this.ao = mat(AO_FRAG, { tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uDepthSize: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() }, uProjScale: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uIntensity: { value: 1 }, uFadeFar: { value: 150 } });
    this.blur = mat(BLUR_FRAG, { tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uDepthSize: { value: new THREE.Vector2(1, 1) }, tAo: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.composite = mat(COMPOSITE_FRAG, { tColor: { value: null }, tAo: { value: null }, uStrength: { value: 0.6 }, uDebug: { value: typeof location !== 'undefined' && new URLSearchParams(location.search).get('post') === 'ao' ? 1 : 0 } });
    this.quad = new THREE.Mesh(geometry, this.ao); this.quad.frustumCulled = false; this.quadScene.add(this.quad);
  }
  private ensure(renderer: THREE.WebGLRenderer) {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (this.target && this.target.width === w && this.target.height === h) return;
    this.disposeTargets();
    const depthTexture = new THREE.DepthTexture(w, h); depthTexture.type = THREE.FloatType;  // 32-bit float depth: 24-bit steps band the occlusion on near ground
    // 4× MSAA at one drawing-buffer pixel per CSS pixel, 2× on high-density screens (their pixels are already small)
    const target = new THREE.WebGLRenderTarget(w, h, { samples: renderer.getPixelRatio() >= 1.5 ? 2 : 4, depthBuffer: true, depthTexture, type: THREE.UnsignedByteType });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    // ... but stored as plain RGBA8 (display-encoded bytes, read back raw): the multisample buffer is RGBA8 for XR targets
    target.texture.internalFormat = 'RGBA8';
    // draw into it exactly as into the canvas: three tone-maps and encodes for XR targets (WebGLRenderer, WebGLPrograms)
    (target as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    target.texture.generateMipmaps = false; target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
    // occlusion at half the CSS resolution: half the drawing buffer at ratio 1, a quarter on high-density screens
    const shift = renderer.getPixelRatio() >= 1.5 ? 2 : 1, hw = Math.max(1, w >> shift), hh = Math.max(1, h >> shift), half = () => { const t = new THREE.WebGLRenderTarget(hw, hh, { depthBuffer: false, type: THREE.UnsignedByteType }); t.texture.generateMipmaps = false; t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter; return t; };
    this.target = target; this.aoTarget = half(); this.blurTarget = half();
  }
  /** Draw scene through the look pass; falls back to a plain draw (and stays there) if a target cannot be made. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (this.failed || !(camera as THREE.PerspectiveCamera).isPerspectiveCamera) { renderer.render(scene, camera); return; }
    const previous = renderer.getRenderTarget(), autoReset = renderer.info.autoReset;
    try {
      this.ensure(renderer);
      const target = this.target!, aoTarget = this.aoTarget!, blurTarget = this.blurTarget!;
      if (autoReset) renderer.info.reset();
      renderer.info.autoReset = false;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const cam = camera as THREE.PerspectiveCamera; // projection as drawn (scene.onBeforeRender fits the near plane)
      const u = this.ao.uniforms, p = this.params;
      u.tDepth.value = target.depthTexture; u.uProjInv.value.copy(cam.projectionMatrixInverse); u.uDepthSize.value.set(target.width, target.height);
      u.uTexel.value.set(1 / aoTarget.width, 1 / aoTarget.height);
      u.uProjScale.value.set(cam.projectionMatrix.elements[0] * 0.5, cam.projectionMatrix.elements[5] * 0.5);
      u.uRadius.value = p.radius; u.uIntensity.value = p.intensity; u.uFadeFar.value = p.fadeFar;
      this.quad.material = this.ao; renderer.setRenderTarget(aoTarget); renderer.render(this.quadScene, this.quadCamera);
      const b = this.blur.uniforms; b.tDepth.value = target.depthTexture; b.uProjInv.value.copy(cam.projectionMatrixInverse); b.uDepthSize.value.set(target.width, target.height); b.tAo.value = aoTarget.texture; b.uTexel.value.set(1 / aoTarget.width, 1 / aoTarget.height);
      this.quad.material = this.blur; renderer.setRenderTarget(blurTarget); renderer.render(this.quadScene, this.quadCamera);
      const c = this.composite.uniforms; c.tColor.value = target.texture; c.tAo.value = blurTarget.texture; c.uStrength.value = p.strength;
      this.quad.material = this.composite; renderer.setRenderTarget(previous); renderer.render(this.quadScene, this.quadCamera);
    } catch (e) {
      this.failed = true; console.warn('look pass unavailable; drawing directly', e);
      renderer.setRenderTarget(previous); renderer.render(scene, camera);
    } finally { renderer.info.autoReset = autoReset; }
  }
  private disposeTargets() { this.target?.depthTexture?.dispose(); this.target?.dispose(); this.aoTarget?.dispose(); this.blurTarget?.dispose(); this.target = this.aoTarget = this.blurTarget = null; }
  dispose() { this.disposeTargets(); this.ao.dispose(); this.blur.dispose(); this.composite.dispose(); this.quad.geometry.dispose(); }
}
