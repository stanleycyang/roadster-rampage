export const groundVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uOrigin;
uniform vec3 uCar;
varying vec2 vRoad;
varying vec2 vCarRel;
varying vec3 vView;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vRoad = vec2(world.x, world.z - uOrigin);
  vCarRel = vec2(world.x - uCar.x, world.z - uCar.z);
  vView = cameraPosition - world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

export const groundFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform float uRoadHalf;
uniform float uDay;
uniform float uRain;
uniform float uTime;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
varying vec2 vRoad;
varying vec2 vCarRel;
varying vec3 vView;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float lineAt(float coord, float target, float width) {
  return 1.0 - smoothstep(width, width + 0.09, abs(coord - target));
}

void main() {
  float x = vRoad.x;
  float z = vRoad.y;
  float ax = abs(x);
  float night = 1.0 - uDay;
  vec3 col = vec3(0.012, 0.008, 0.02);

  if (ax < uRoadHalf + 1.35) {
    float grain = hash(floor(vec2(x, z) * 2.4));
    vec3 asphalt = vec3(0.018, 0.016, 0.022) + grain * 0.012;
    float shoulder = smoothstep(uRoadHalf - 0.4, uRoadHalf + 1.1, ax);
    asphalt = mix(asphalt, vec3(0.03, 0.02, 0.035), shoulder * 0.65);

    float along = fract(z / 10.0);
    float dash = smoothstep(0.0, 0.04, along) * (1.0 - smoothstep(0.34, 0.42, along));
    float marks = 0.0;
    marks += lineAt(x, -5.25, 0.045) * dash;
    marks += lineAt(x, -1.75, 0.045) * dash;
    marks += lineAt(x, 1.75, 0.045) * dash;
    marks += lineAt(x, 5.25, 0.045) * dash;
    float edge = lineAt(ax, uRoadHalf - 0.08, 0.05);
    float neon = lineAt(ax, uRoadHalf + 0.28, 0.07);

    vec3 markCol = vec3(0.75, 0.78, 0.85);
    vec3 neonCol = x < 0.0 ? vec3(1.8, 0.15, 0.85) : vec3(0.15, 1.15, 1.7);
    asphalt += markCol * marks * (0.55 + night * 0.7);
    asphalt += vec3(0.9, 0.95, 1.0) * edge * (0.35 + night * 0.4);
    asphalt += neonCol * neon * (0.45 + night * 1.1);

    float nA = hash(floor(vec2(x * 0.31 + 2.0, z * 0.27)));
    float nB = hash(floor(vec2(x * 0.11, z * 0.13 + 9.0)));
    float puddle = smoothstep(0.62, 0.84, nA) * smoothstep(0.35, 0.72, nB);
    float wet = clamp(puddle * 0.85 + uRain * 0.9, 0.0, 1.0);
    asphalt = mix(asphalt, asphalt * vec3(0.35, 0.38, 0.42), wet);

    float ripple = sin(x * 1.7 + uTime * 2.4) * sin(z * 1.3 - uTime * 1.8);
    ripple = mix(ripple * 0.15, ripple, max(uRain, wet));
    vec3 N = normalize(vec3(ripple * 0.22, 1.0, ripple * 0.22));
    vec3 V = normalize(vView);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), mix(22.0, 160.0, wet));
    float fres = pow(1.0 - max(dot(N, V), 0.0), mix(4.0, 2.4, wet));
    vec3 skyRef = mix(uHorizon, vec3(0.55, 0.22, 0.16), 0.35 + uDay * 0.4);
    asphalt += skyRef * spec * (0.12 + wet * 1.15 + uRain * 0.35);
    asphalt = mix(asphalt, skyRef, fres * (0.04 + wet * 0.42));

    float ahead = vCarRel.y - 5.0;
    float head = exp(-pow(vCarRel.x / 2.7, 2.0) - pow(ahead / 16.0, 2.0));
    asphalt += vec3(0.55, 0.72, 0.95) * head * (0.22 + night * 0.7);
    col = asphalt;
  } else {
    float cell = 4.0;
    float fx = fract(x / cell);
    float fz = fract(z / cell);
    float dx = min(fx, 1.0 - fx) * cell;
    float dz = min(fz, 1.0 - fz) * cell;
    float lx = 1.0 - smoothstep(0.045, 0.16, dx);
    float lz = 1.0 - smoothstep(0.045, 0.16, dz);
    float grid = max(lx, lz);
    float dist = length(vCarRel);
    float fade = exp(-max(0.0, dist - 18.0) * 0.016);
    vec3 gcol = mix(vec3(1.7, 0.12, 0.75), vec3(0.15, 1.25, 1.65), smoothstep(-30.0, 30.0, x));
    col += gcol * grid * fade * (0.28 + night * 0.95);
    float haze = smoothstep(40.0, 220.0, dist);
    col = mix(col, uHorizon * 0.65, haze * 0.55);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`

export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const skyFragment = /* glsl */ `
uniform float uDay;
uniform float uTime;
uniform float uLightning;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float day = clamp(uDay, 0.0, 1.0);
  float night = 1.0 - day;

  vec3 zenith = mix(vec3(0.01, 0.012, 0.035), vec3(0.13, 0.045, 0.2), day);
  vec3 hor = mix(vec3(0.09, 0.025, 0.12), vec3(0.92, 0.30, 0.16), day);
  float elev = smoothstep(-0.12, 0.58, h);
  vec3 col = mix(hor, zenith, elev);
  float band = exp(-pow((h - 0.015) * (7.0 + night * 5.0), 2.0));
  col += band * mix(vec3(0.32, 0.04, 0.22), vec3(1.0, 0.26, 0.32), day) * 0.5;

  vec3 sunDir = normalize(vec3(-0.42, -0.04 + day * 0.66, 0.72));
  float sunDot = max(dot(dir, sunDir), 0.0);
  col += pow(sunDot, 14.0) * vec3(1.0, 0.42, 0.16) * day * 0.7;
  col += smoothstep(0.999, 0.9996, sunDot) * vec3(1.15, 0.72, 0.35) * day;

  vec3 moonDir = normalize(vec3(0.52, 0.38, 0.48));
  float moonDot = max(dot(dir, moonDir), 0.0);
  col += smoothstep(0.9993, 0.99975, moonDot) * vec3(0.8, 0.9, 1.05) * night;
  col += pow(moonDot, 20.0) * vec3(0.22, 0.32, 0.5) * night;

  vec3 cell = floor(dir * 230.0);
  float hs = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  if (hs > 0.986 && h > 0.06) {
    float tw = 0.7 + 0.3 * sin(uTime * 2.4 + hs * 60.0);
    col += vec3(0.85, 0.92, 1.0) * (hs - 0.986) * 55.0 * night * tw;
  }

  float grain = fract(sin(dot(dir.xy + uTime * 0.01, vec2(12.9, 78.2))) * 43758.5);
  col += (grain - 0.5) * 0.012;
  col += vec3(0.65, 0.75, 1.0) * uLightning * 0.65;
  gl_FragColor = vec4(col, 1.0);
}
`

export const SpeedShader = {
  name: 'SpeedLines',
  uniforms: {
    tDiffuse: { value: null as null },
    uSpeed: { value: 0 },
    uTime: { value: 0 },
    uOverdrive: { value: 0 },
    uAspect: { value: 1 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uTime;
    uniform float uOverdrive;
    uniform float uAspect;
    uniform float uFlash;
    varying vec2 vUv;
    void main() {
      vec2 center = vec2(0.5, 0.45);
      float speed = clamp(uSpeed, 0.0, 1.0);
      float blur = smoothstep(0.22, 1.0, speed) * 0.012 * (1.0 - uOverdrive * 0.65);
      vec2 dir = vUv - center;
      vec2 streak = vec2(0.0, blur * 1.6);
      vec3 col = vec3(0.0);
      const int N = 7;
      for (int i = 0; i < N; i++) {
        float f = float(i) / 6.0;
        vec2 o = dir * blur * f + streak * (f - 0.5);
        col.r += texture2D(tDiffuse, vUv - o * (1.0 + blur * 6.0)).r;
        col.g += texture2D(tDiffuse, vUv - o).g;
        col.b += texture2D(tDiffuse, vUv - o * (1.0 - blur * 5.0)).b;
      }
      col /= float(N);

      vec2 p = vUv - center;
      p.x *= uAspect;
      float ang = atan(p.y, p.x);
      float r = length(p);
      float rays = pow(abs(sin(ang * 22.0 + uTime * (1.5 + speed * 8.0))), 48.0);
      float rayMask = smoothstep(0.22, 0.95, r) * smoothstep(0.25, 0.7, speed) * (1.0 - uOverdrive * 0.85);
      col += rays * rayMask * vec3(0.65, 0.85, 1.0) * 0.28;

      float vig = smoothstep(1.2, 0.25, length(p));
      col *= mix(0.62, 1.0, vig);

      col *= 1.0 + uOverdrive * 0.08;
      col += vec3(0.45, 0.05, 0.22) * uOverdrive * 0.12;
      col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}
