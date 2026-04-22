export const VERT_QUAD = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Splat: additive Gaussian force into the velocity field.
export const FRAG_SPLAT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uPoint;
uniform vec2 uForce;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float g = exp(-dot(p, p) / uRadius);
  vec2 base = texture(uSource, vUv).xy;
  outColor = vec4(base + uForce * g, 0.0, 1.0);
}
`;

// Semi-Lagrangian advection. Velocity is in grid-cells per second;
// multiplying by uTexel converts to uv-per-second for the back-trace.
export const FRAG_ADVECT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  outColor = texture(uSource, coord) * uDissipation;
}
`;

export const FRAG_DIVERGENCE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float l = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}
`;

export const FRAG_PRESSURE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float d = texture(uDivergence, vUv).x;
  outColor = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const FRAG_PROJECT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform sampler2D uPressure;
uniform vec2 uTexel;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVelocity, vUv).xy;
  v -= 0.5 * vec2(r - l, t - b);
  outColor = vec4(v, 0.0, 1.0);
}
`;

// Collider: inside the disc, velocity is overwritten to the disc's own
// velocity (the fingertip's). Smooth feather at the edge avoids a hard
// discontinuity. Applied BEFORE divergence/pressure so the projection
// step redistributes fluid around the disc rather than into it.
export const FRAG_COLLIDER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uSoftness;
uniform vec2 uDiscVel;
uniform float uAspect;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float d = length(p);
  // Inside [0, radius] = full disc; over [radius, radius+softness] feather
  // to ambient; beyond = unchanged.
  float m = smoothstep(uRadius, uRadius + uSoftness, d);
  vec2 v = texture(uVelocity, vUv).xy;
  outColor = vec4(mix(uDiscVel, v, m), 0.0, 1.0);
}
`;

// Glow update: in one pass, advect the scalar glow field through the
// velocity field, multiply by a per-frame decay, and add a source term
// driven by local vorticity (curl of velocity). High vorticity = fluid
// is being sheared by the disc's motion = it lights up. Clamped to 1.0
// so over-bright regions reach the cyan core but then decay back down.
export const FRAG_GLOW_UPDATE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform sampler2D uGlow;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDecay;
uniform float uSourceStrength;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel;
  float advected = texture(uGlow, coord).x;

  // 2D vorticity: ∂v/∂x - ∂u/∂y. Central differences.
  float vL = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float vR = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float uB = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float uT = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  float vort = 0.5 * ((vR - vL) - (uT - uB));
  float source = abs(vort) * uSourceStrength;

  float g = clamp(advected * uDecay + source, 0.0, 1.0);
  outColor = vec4(g, 0.0, 0.0, 1.0);
}
`;

// Glow display: sample glow scalar, map through the navy → cyan ramp.
// Four stops, piecewise linear. Stops pulled from the plan.
export const FRAG_GLOW_DISPLAY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uGlow;
uniform float uBrightness;
vec3 rampColor(float t) {
  const vec3 C0 = vec3(0.0, 0.0, 0.0);
  const vec3 C1 = vec3(0.039, 0.137, 0.251);  // #0a2340 deep navy
  const vec3 C2 = vec3(0.227, 0.561, 0.850);  // #3a8fd9 electric blue
  const vec3 C3 = vec3(0.498, 0.875, 1.000);  // #7fdfff cyan core
  t = clamp(t, 0.0, 1.0);
  if (t < 0.3) return mix(C0, C1, t / 0.3);
  if (t < 0.7) return mix(C1, C2, (t - 0.3) / 0.4);
  return mix(C2, C3, (t - 0.7) / 0.3);
}
void main() {
  float g = clamp(texture(uGlow, vUv).x * uBrightness, 0.0, 1.0);
  outColor = vec4(rampColor(g), 1.0);
}
`;

// Warp update: the surface noise is sampled through a displacement field
// that's dragged along by the fluid. Each frame the field is back-advected
// through velocity (so past displacement moves with the flow), decays
// slightly, and picks up the current velocity-step as new displacement.
// At rest the field asymptotes to zero and filaments settle to identity UV.
export const FRAG_WARP_UPDATE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform sampler2D uWarp;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDecay;
uniform float uGain;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel;
  vec2 advected = texture(uWarp, coord).xy * uDecay;
  vec2 newStep = vel * uTexel * uDt * uGain;
  outColor = vec4(advected + newStep, 0.0, 1.0);
}
`;

// Ocean display: dark calm water with summed Gerstner-style waves.
// Four coprime wave directions produce a non-tiling normal field.
// The warp texture (finger disturbance from the fluid sim) perturbs
// normals locally so the finger "stirs" the water.
// Sky gradient + sun disc are sampled through the reflected view;
// Fresnel mixes that reflection over a dark water base color.
// Rendered opaque; the glow pass blends additively on top of this.
export const FRAG_SURFACE_DISPLAY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uWarp;
uniform float uTime;
uniform float uAspect;
uniform float uWaveAmplitude;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform float uDisturbStrength;

uniform vec3 uWaterBase;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec2 uSunPos;
uniform float uSunRadius;
uniform vec3 uSunColor;
uniform float uSunBrightness;
uniform float uFresnelExp;

// Height-field waves summed; gradient → surface normal.
vec3 oceanNormal(vec2 p, float t, float amp) {
  vec2 grad = vec2(0.0);
  {
    vec2 d = vec2(0.95, 0.31);
    float f = 3.0;
    grad += d * f * 0.50 * cos(dot(d, p) * f + t * 0.30);
  }
  {
    vec2 d = vec2(-0.41, 0.91);
    float f = 7.0;
    grad += d * f * 0.30 * cos(dot(d, p) * f + t * 0.60);
  }
  {
    vec2 d = vec2(0.77, -0.64);
    float f = 15.0;
    grad += d * f * 0.15 * cos(dot(d, p) * f + t * 1.00);
  }
  {
    vec2 d = vec2(0.29, 0.96);
    float f = 30.0;
    grad += d * f * 0.08 * cos(dot(d, p) * f + t * 1.40);
  }
  grad *= amp;
  return normalize(vec3(-grad, 1.0));
}

// Project the reflected view onto a 2D "sky map" centered at zenith.
// Gradient from zenith (center) to horizon (r≈1), with a sun disc.
vec3 sampleSky(vec2 skyPos) {
  float r = length(skyPos);
  vec3 col = mix(uSkyZenith, uSkyHorizon, smoothstep(0.0, 1.0, r));
  float d = length(skyPos - uSunPos);
  float sun = smoothstep(uSunRadius, uSunRadius * 0.25, d);
  col += uSunColor * sun * uSunBrightness;
  return col;
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y) * uWaveScale;
  vec3 n = oceanNormal(p, uTime * uWaveSpeed, uWaveAmplitude);

  // Finger disturbance: warp vector → small lateral tilt of the normal.
  vec2 warp = texture(uWarp, vUv).xy;
  n = normalize(n + vec3(-warp * uDisturbStrength, 0.0));

  // For a top-down view, reflected ray xy ≈ 2 * n.xy (near-flat approx).
  vec2 skyPos = 2.0 * n.xy;
  vec3 skyColor = sampleSky(skyPos);

  float fresnel = pow(clamp(1.0 - n.z, 0.0, 1.0), uFresnelExp);
  vec3 color = mix(uWaterBase, skyColor, fresnel);

  outColor = vec4(color, 1.0);
}
`;

// Fish point rendering. Each fish is an instanced gl.POINTS vertex with
// (x, y) in [0,1] UV, depth [0,1], and current speed (uv/sec). Depth
// attenuates size + brightness and shifts color cyan→navy.
// Rendered additively into the trail FBO.
export const VERT_FISH = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aDepth;
layout(location = 2) in float aSpeed;
uniform float uSizeBase;
uniform float uDprScale;
out float vDepth;
out float vSpeed;
void main() {
  // UV (y=0 top) → clip space (y=+1 top).
  vec2 clip = vec2(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  float sizeScale = mix(1.0, 0.4, aDepth);
  gl_PointSize = uSizeBase * sizeScale * uDprScale;
  vDepth = aDepth;
  vSpeed = aSpeed;
}
`;

export const FRAG_FISH = /* glsl */ `#version 300 es
precision highp float;
in float vDepth;
in float vSpeed;
out vec4 outColor;
uniform float uGlowBase;
uniform float uGlowSpeedScale;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c);
  // Gaussian falloff. sigma ~= 0.2.
  float g = exp(-d2 * 18.0);
  // Color: cyan at surface (depth=0) to navy in deep (depth=1).
  vec3 nearCol = vec3(0.55, 0.92, 1.00);
  vec3 deepCol = vec3(0.05, 0.12, 0.28);
  vec3 col = mix(nearCol, deepCol, vDepth);
  // Intensity: baseline + velocity flare, attenuated by depth.
  float intensity = (uGlowBase + vSpeed * uGlowSpeedScale) * mix(1.0, 0.35, vDepth);
  vec3 rgb = col * intensity * g;
  outColor = vec4(rgb, g);
}
`;

// Trail decay: multiply the fish trail FBO by a constant each frame.
// Ping-ponged read→write. Shorter decay = shorter trails.
export const FRAG_FISH_DECAY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTrail;
uniform float uDecay;
void main() {
  outColor = texture(uTrail, vUv) * uDecay;
}
`;

// Composite the fish trail FBO additively into the final output.
export const FRAG_FISH_COMPOSITE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTrail;
uniform float uStrength;
void main() {
  outColor = vec4(texture(uTrail, vUv).rgb * uStrength, 1.0);
}
`;

// Legacy grayscale velocity view — kept for dev overlay in stage 6.
export const FRAG_DISPLAY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform float uScale;
void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  float m = clamp(length(v) * uScale, 0.0, 1.0);
  outColor = vec4(vec3(m), 1.0);
}
`;
