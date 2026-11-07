// #1166: the light a world arrives through. Plain WebGL2, no library: download progress drives the size of the light, and
// time only keeps its rays alive. It runs beside the world's own first load, so it draws small and slow, and it stops
// for good the moment the screen is white. Without WebGL2 the caller's CSS disc does the same job (`startLight` is null).

export const DISSOLVE_MS = 2000;
/** The last of the light, as a compositor transition (world-chrome.css `data-fill`). */
export const FILL_MS = 1200;
/** The CSS disc's solid radius at scale 1 (world-chrome.css). */
export const DISC_RADIUS = 146;
/** Radius of the part that reads as solid white, at scale 1, as a fraction of the screen's short side (see FRAG). */
export const SOLID = 0.16;
/** Text that sits on the light needs this much white around it, in CSS pixels. */
export const TEXT_MARGIN = 20;
/** Fastest the radius may move, in fractions of the whole way per second: a clump of progress reads as a swell. */
const RATE = 0.6, TAU = 0.35;
/** The drawing buffer's long side and the frame rate; the picture is soft, so it upscales well. At 640 px and 30 fps a
 *  software renderer slowed the world's download by about half a second on a phone-sized page; here it doesn't measurably. */
const MAX_SIDE = 480;
export const FRAME_MS = 1000 / 24;

/** The radius from just covering the text to reaching the corners, in CSS pixels. */
export const lightRadius = (fraction: number, width: number, height: number, textHalf: number) =>
  textHalf + (Math.hypot(width, height) / 2 - textHalf) * fraction;
/** The shader's scale for a solid-white radius of `radius` CSS pixels. */
export const lightScale = (radius: number, width: number, height: number) => radius / (SOLID * Math.min(width, height));

/** One step of the radius toward `target`: it eases, moves at a capped speed and never shrinks. */
export function easeFraction(fraction: number, target: number, seconds: number): number {
  const dt = Math.max(0, Math.min(seconds, 0.25));
  const goal = Math.max(fraction, Math.min(1, target)), left = goal - fraction;
  if (left < 0.001) return goal;
  return fraction + Math.min(left * (1 - Math.exp(-dt / TAU)), RATE * dt);
}

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uScale;
out vec4 outColor;

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uint v) { return float(pcg(v)) / 4294967295.0; }

// 2D simplex noise (Ashima / Gustavson)
vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x / 289.0) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  float s = min(uRes.x, uRes.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / s;
  p.y = -p.y;
  float t = uTime;
  p /= max(uScale, 1e-4);

  float r = length(p);
  float ang = atan(p.y, p.x);
  vec2 cs = vec2(cos(ang), sin(ang));      // noise on a circle: no seam, depends on angle only

  // straight radial streaks at several widths, each drifting slowly
  float s1 = snoise(cs * 1.2 + vec2(t * 0.020, 0.0));
  float s2 = snoise(cs * 5.0 + vec2(0.0, t * 0.035));
  float s3 = snoise(cs * 16.0 + vec2(t * 0.050, 3.0));
  float s4 = snoise(cs * 42.0 + vec2(5.0, t * 0.070));
  float rays = 0.6 * s2 + 0.32 * s3 + 0.08 * s4;

  // groups of rays slowly brighten and dim
  float g = snoise(cs * 7.0 + vec2(t * 0.11, 9.0));
  float gain = 1.0 + 0.25 * max(g, 0.0) * max(g, 0.0) - 0.06 * max(-g, 0.0);

  // the light reaches a little further toward the upper left
  vec2 d = normalize(vec2(-0.82, -0.55));
  float lobe = pow(max(dot(cs, d), 0.0), 3.0);

  float reach = 1.0 + 0.06 * s1 + 0.012 * rays + 0.20 * lobe;
  float rr = r / reach;

  float core = exp(-pow(r / 0.125, 2.4)) * 2.4;
  float halo = exp(-pow(rr / 0.23, 1.6)) * 0.75;
  float haze = exp(-rr / 0.13) * 0.18;
  float tex = (1.0 + 0.10 * rays) * gain;
  float I = core + halo * tex + haze * mix(1.0, tex, 0.6);
  I *= 1.0 + 0.012 * snoise(vec2(t * 0.25, 3.1));   // a slow, tiny breath

  // warm tonemap: dim reads peach-grey, bright saturates to white
  vec3 col = 1.0 - exp(-I * vec3(2.4, 2.15, 1.95));
  col *= smoothstep(0.62, 0.2, length(p));

  // triangular dither against banding
  uvec2 fc = uvec2(gl_FragCoord.xy);
  uint seed = fc.x * 1973u + fc.y * 9277u + uint(fract(t) * 1000.0) * 26699u;
  float n = rnd(seed) + rnd(seed ^ 0x9E3779B9u) - 1.0;
  col += n / 255.0;

  outColor = vec4(col, 1.0);
}`;

export type Light = { draw(scale: number, seconds: number): void; stop(): void };

/** The light on `canvas`, or null when it can't run; the arrival never depends on it. */
export function startLight(canvas: HTMLCanvasElement, onLost: () => void): Light | null {
  try {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type); if (!s) throw Error('no shader');
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const program = gl.createProgram(); if (!program) return null;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? 'program');
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, 'a'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, 'uRes'), uTime = gl.getUniformLocation(program, 'uTime');
    const uScale = gl.getUniformLocation(program, 'uScale');
    canvas.addEventListener('webglcontextlost', onLost, { once: true });
    return {
      draw(scale, seconds) {
        const css = canvas.getBoundingClientRect(), fit = Math.min(1, MAX_SIDE / Math.max(css.width, css.height, 1));
        const w = Math.max(1, Math.round(css.width * fit)), h = Math.max(1, Math.round(css.height * fit));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
        gl.uniform2f(uRes, w, h); gl.uniform1f(uTime, seconds); gl.uniform1f(uScale, scale);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      stop() { canvas.removeEventListener('webglcontextlost', onLost); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
    };
  } catch (e) { console.warn('arrival light', e); return null; }
}
