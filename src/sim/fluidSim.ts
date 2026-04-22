import type { FingertipState } from '../hands/useHandLandmarker';
import {
  createFBO,
  createPingPong,
  createQuad,
  destroyFBO,
  link,
  type FBO,
  type PingPong,
} from './gl';
import { Boids } from './boids';
import type {
  FishParams,
  FluidSimParams,
  GlowParams,
  SurfaceParams,
} from './params';
import {
  FRAG_ADVECT,
  FRAG_COLLIDER,
  FRAG_DIVERGENCE,
  FRAG_FISH,
  FRAG_FISH_COMPOSITE,
  FRAG_FISH_DECAY,
  FRAG_GLOW_DISPLAY,
  FRAG_GLOW_UPDATE,
  FRAG_PRESSURE,
  FRAG_PROJECT,
  FRAG_SPLAT,
  FRAG_SURFACE_DISPLAY,
  FRAG_WARP_UPDATE,
  VERT_FISH,
  VERT_QUAD,
} from './shaders';

export class FluidSim {
  private gl: WebGL2RenderingContext;
  private quad: WebGLVertexArrayObject;
  private progSplat: WebGLProgram;
  private progAdvect: WebGLProgram;
  private progCollider: WebGLProgram;
  private progDivergence: WebGLProgram;
  private progPressure: WebGLProgram;
  private progProject: WebGLProgram;
  private progGlowUpdate: WebGLProgram;
  private progGlowDisplay: WebGLProgram;
  private progWarpUpdate: WebGLProgram;
  private progSurfaceDisplay: WebGLProgram;
  private progFish: WebGLProgram;
  private progFishDecay: WebGLProgram;
  private progFishComposite: WebGLProgram;

  private velocity: PingPong | null = null;
  private divergence: FBO | null = null;
  private pressure: PingPong | null = null;
  private glow: PingPong | null = null;
  private warp: PingPong | null = null;
  private fishTrail: PingPong | null = null;

  private boids: Boids;
  private fishVao: WebGLVertexArrayObject;
  private fishBuffer: WebGLBuffer;
  private fishBufferCapacity = 0;

  // Accumulated time for surface drift animation.
  private elapsed = 0;

  private gridW = 0;
  private gridH = 0;
  private displayW = 0;
  private displayH = 0;

  // Per-finger smoothed velocity (EMA), keyed by fingertip id. Each
  // active finger has its own smoothing state so many fingers smooth
  // independently; stale entries are evicted when a finger departs.
  private smoothMap = new Map<string, { vx: number; vy: number }>();

  private params: FluidSimParams;
  private glowParams: GlowParams;
  private surfaceParams: SurfaceParams;
  private fishParams: FishParams;

  constructor(
    canvas: HTMLCanvasElement,
    params: FluidSimParams,
    glowParams: GlowParams,
    surfaceParams: SurfaceParams,
    fishParams: FishParams,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error(
        'EXT_color_buffer_float unavailable — float FBOs are required',
      );
    }
    this.gl = gl;
    this.params = params;
    this.glowParams = glowParams;
    this.surfaceParams = surfaceParams;
    this.fishParams = fishParams;
    this.quad = createQuad(gl);
    this.progSplat = link(gl, VERT_QUAD, FRAG_SPLAT);
    this.progAdvect = link(gl, VERT_QUAD, FRAG_ADVECT);
    this.progCollider = link(gl, VERT_QUAD, FRAG_COLLIDER);
    this.progDivergence = link(gl, VERT_QUAD, FRAG_DIVERGENCE);
    this.progPressure = link(gl, VERT_QUAD, FRAG_PRESSURE);
    this.progProject = link(gl, VERT_QUAD, FRAG_PROJECT);
    this.progGlowUpdate = link(gl, VERT_QUAD, FRAG_GLOW_UPDATE);
    this.progGlowDisplay = link(gl, VERT_QUAD, FRAG_GLOW_DISPLAY);
    this.progWarpUpdate = link(gl, VERT_QUAD, FRAG_WARP_UPDATE);
    this.progSurfaceDisplay = link(gl, VERT_QUAD, FRAG_SURFACE_DISPLAY);
    this.progFish = link(gl, VERT_FISH, FRAG_FISH);
    this.progFishDecay = link(gl, VERT_QUAD, FRAG_FISH_DECAY);
    this.progFishComposite = link(gl, VERT_QUAD, FRAG_FISH_COMPOSITE);

    // Fish: boids sim + per-instance vertex buffer (vec4 per fish).
    this.boids = new Boids(fishParams.count);
    const fishVao = gl.createVertexArray();
    if (!fishVao) throw new Error('createVertexArray fish failed');
    this.fishVao = fishVao;
    const fishBuf = gl.createBuffer();
    if (!fishBuf) throw new Error('createBuffer fish failed');
    this.fishBuffer = fishBuf;
    gl.bindVertexArray(fishVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, fishBuf);
    const stride = 4 * 4; // 4 floats × 4 bytes
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 3 * 4);
    gl.bindVertexArray(null);
  }

  setParams(p: FluidSimParams) {
    const resChanged = p.simResolution !== this.params.simResolution;
    this.params = p;
    if (resChanged) this.resize(this.displayW, this.displayH, true);
  }

  setGlowParams(p: GlowParams) {
    this.glowParams = p;
  }

  setSurfaceParams(p: SurfaceParams) {
    this.surfaceParams = p;
  }

  setFishParams(p: FishParams) {
    const countChanged = Math.round(p.count) !== this.boids.count;
    this.fishParams = p;
    if (countChanged) this.boids.resize(Math.round(p.count));
  }

  resize(displayW: number, displayH: number, force = false) {
    if (displayW <= 0 || displayH <= 0) return;
    this.displayW = displayW;
    this.displayH = displayH;
    const aspect = displayW / displayH;
    const r = this.params.simResolution;
    const gw = aspect >= 1 ? r : Math.max(2, Math.round(r * aspect));
    const gh = aspect >= 1 ? Math.max(2, Math.round(r / aspect)) : r;
    if (!force && gw === this.gridW && gh === this.gridH && this.velocity) return;

    const gl = this.gl;
    if (this.velocity) {
      destroyFBO(gl, this.velocity.read);
      destroyFBO(gl, this.velocity.write);
    }
    if (this.divergence) destroyFBO(gl, this.divergence);
    if (this.pressure) {
      destroyFBO(gl, this.pressure.read);
      destroyFBO(gl, this.pressure.write);
    }
    if (this.glow) {
      destroyFBO(gl, this.glow.read);
      destroyFBO(gl, this.glow.write);
    }
    if (this.warp) {
      destroyFBO(gl, this.warp.read);
      destroyFBO(gl, this.warp.write);
    }
    if (this.fishTrail) {
      destroyFBO(gl, this.fishTrail.read);
      destroyFBO(gl, this.fishTrail.write);
    }

    this.gridW = gw;
    this.gridH = gh;
    this.velocity = createPingPong(
      gl,
      gw,
      gh,
      gl.RG16F,
      gl.RG,
      gl.HALF_FLOAT,
      gl.LINEAR,
    );
    this.divergence = createFBO(
      gl,
      gw,
      gh,
      gl.R16F,
      gl.RED,
      gl.HALF_FLOAT,
      gl.NEAREST,
    );
    this.pressure = createPingPong(
      gl,
      gw,
      gh,
      gl.R16F,
      gl.RED,
      gl.HALF_FLOAT,
      gl.NEAREST,
    );
    // Glow uses LINEAR so advection + display sample smoothly.
    this.glow = createPingPong(
      gl,
      gw,
      gh,
      gl.R16F,
      gl.RED,
      gl.HALF_FLOAT,
      gl.LINEAR,
    );
    // Warp is a 2D UV displacement field — RG16F.
    this.warp = createPingPong(
      gl,
      gw,
      gh,
      gl.RG16F,
      gl.RG,
      gl.HALF_FLOAT,
      gl.LINEAR,
    );
    // Fish trail: RGBA16F, additively accumulates fish point renders
    // and decays each frame.
    this.fishTrail = createPingPong(
      gl,
      gw,
      gh,
      gl.RGBA16F,
      gl.RGBA,
      gl.HALF_FLOAT,
      gl.LINEAR,
    );

    // Clear all float buffers to zero so we start dormant.
    for (const fbo of [
      this.velocity.read,
      this.velocity.write,
      this.pressure.read,
      this.pressure.write,
      this.glow.read,
      this.glow.write,
      this.warp.read,
      this.warp.write,
      this.fishTrail.read,
      this.fishTrail.write,
    ]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private draw(fbo: FBO | null) {
    const gl = this.gl;
    if (fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
      gl.viewport(0, 0, fbo.width, fbo.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.displayW, this.displayH);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private splat(
    pointX: number,
    pointY: number,
    forceX: number,
    forceY: number,
  ) {
    if (!this.velocity) return;
    const gl = this.gl;
    gl.useProgram(this.progSplat);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progSplat, 'uSource'), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.progSplat, 'uPoint'),
      pointX,
      pointY,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.progSplat, 'uForce'),
      forceX,
      forceY,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSplat, 'uRadius'),
      this.params.splatRadius,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSplat, 'uAspect'),
      this.displayW / this.displayH,
    );
    this.draw(this.velocity.write);
    this.velocity.swap();
  }

  private advect(dt: number) {
    if (!this.velocity) return;
    const gl = this.gl;
    gl.useProgram(this.progAdvect);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progAdvect, 'uVelocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this.progAdvect, 'uSource'), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.progAdvect, 'uTexel'),
      this.velocity.read.texel[0],
      this.velocity.read.texel[1],
    );
    gl.uniform1f(gl.getUniformLocation(this.progAdvect, 'uDt'), dt);
    gl.uniform1f(
      gl.getUniformLocation(this.progAdvect, 'uDissipation'),
      this.params.velocityDissipation,
    );
    this.draw(this.velocity.write);
    this.velocity.swap();
  }

  private applyCollider(pointX: number, pointY: number, velX: number, velY: number) {
    if (!this.velocity) return;
    const gl = this.gl;
    gl.useProgram(this.progCollider);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progCollider, 'uVelocity'), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.progCollider, 'uPoint'),
      pointX,
      pointY,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progCollider, 'uRadius'),
      this.params.colliderRadius,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progCollider, 'uSoftness'),
      this.params.colliderSoftness,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.progCollider, 'uDiscVel'),
      velX,
      velY,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progCollider, 'uAspect'),
      this.displayW / this.displayH,
    );
    this.draw(this.velocity.write);
    this.velocity.swap();
  }

  private computeDivergence() {
    if (!this.velocity || !this.divergence) return;
    const gl = this.gl;
    gl.useProgram(this.progDivergence);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progDivergence, 'uVelocity'), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.progDivergence, 'uTexel'),
      this.velocity.read.texel[0],
      this.velocity.read.texel[1],
    );
    this.draw(this.divergence);
  }

  private solvePressure() {
    if (!this.pressure || !this.divergence) return;
    const gl = this.gl;
    // Reset pressure to zero for a fresh solve each frame.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.progPressure);
    gl.bindVertexArray(this.quad);
    const iters = Math.max(1, Math.round(this.params.pressureIterations));
    for (let i = 0; i < iters; i++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.tex);
      gl.uniform1i(gl.getUniformLocation(this.progPressure, 'uPressure'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.divergence.tex);
      gl.uniform1i(gl.getUniformLocation(this.progPressure, 'uDivergence'), 1);
      gl.uniform2f(
        gl.getUniformLocation(this.progPressure, 'uTexel'),
        this.pressure.read.texel[0],
        this.pressure.read.texel[1],
      );
      this.draw(this.pressure.write);
      this.pressure.swap();
    }
  }

  private project() {
    if (!this.velocity || !this.pressure) return;
    const gl = this.gl;
    gl.useProgram(this.progProject);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progProject, 'uVelocity'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progProject, 'uPressure'), 1);
    gl.uniform2f(
      gl.getUniformLocation(this.progProject, 'uTexel'),
      this.velocity.read.texel[0],
      this.velocity.read.texel[1],
    );
    this.draw(this.velocity.write);
    this.velocity.swap();
  }

  private updateWarp(dt: number) {
    if (!this.warp || !this.velocity) return;
    const gl = this.gl;
    gl.useProgram(this.progWarpUpdate);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progWarpUpdate, 'uVelocity'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.warp.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progWarpUpdate, 'uWarp'), 1);
    gl.uniform2f(
      gl.getUniformLocation(this.progWarpUpdate, 'uTexel'),
      this.warp.read.texel[0],
      this.warp.read.texel[1],
    );
    gl.uniform1f(gl.getUniformLocation(this.progWarpUpdate, 'uDt'), dt);
    gl.uniform1f(
      gl.getUniformLocation(this.progWarpUpdate, 'uDecay'),
      this.surfaceParams.warpDecay,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progWarpUpdate, 'uGain'),
      this.surfaceParams.warpGain,
    );
    this.draw(this.warp.write);
    this.warp.swap();
  }

  private updateGlow(dt: number) {
    if (!this.glow || !this.velocity) return;
    const gl = this.gl;
    gl.useProgram(this.progGlowUpdate);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progGlowUpdate, 'uVelocity'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.glow.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progGlowUpdate, 'uGlow'), 1);
    gl.uniform2f(
      gl.getUniformLocation(this.progGlowUpdate, 'uTexel'),
      this.glow.read.texel[0],
      this.glow.read.texel[1],
    );
    gl.uniform1f(gl.getUniformLocation(this.progGlowUpdate, 'uDt'), dt);
    gl.uniform1f(
      gl.getUniformLocation(this.progGlowUpdate, 'uDecay'),
      this.glowParams.decay,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progGlowUpdate, 'uSourceStrength'),
      this.glowParams.sourceStrength,
    );
    this.draw(this.glow.write);
    this.glow.swap();
  }

  private updateFish(dt: number, fingertips: FingertipState[]) {
    if (!this.fishTrail) return;
    const gl = this.gl;
    const boids = this.boids;

    // CPU boids update + pack interleaved buffer.
    boids.update(dt, fingertips, this.fishParams);

    // Upload to GL buffer. Grow if needed.
    const buf = boids.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fishBuffer);
    if (buf.byteLength > this.fishBufferCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
      this.fishBufferCapacity = buf.byteLength;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf);
    }

    // Decay the trail FBO (ping-pong read → write * decay).
    gl.disable(gl.BLEND);
    gl.useProgram(this.progFishDecay);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fishTrail.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progFishDecay, 'uTrail'), 0);
    gl.uniform1f(
      gl.getUniformLocation(this.progFishDecay, 'uDecay'),
      this.fishParams.trailDecay,
    );
    this.draw(this.fishTrail.write);
    this.fishTrail.swap();

    // Draw fish additively into the (now-write-side) trail FBO.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fishTrail.read.fbo);
    gl.viewport(0, 0, this.fishTrail.read.width, this.fishTrail.read.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.progFish);
    gl.bindVertexArray(this.fishVao);
    // Point size is in framebuffer pixels; scale from "CSS px" using the
    // sim grid size vs a reference resolution.
    const dprScale = this.fishTrail.read.width / 512.0;
    gl.uniform1f(
      gl.getUniformLocation(this.progFish, 'uSizeBase'),
      this.fishParams.fishSize,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progFish, 'uDprScale'),
      dprScale,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progFish, 'uGlowBase'),
      this.fishParams.glowBase,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progFish, 'uGlowSpeedScale'),
      this.fishParams.glowSpeedScale,
    );
    gl.drawArrays(gl.POINTS, 0, boids.count);
    gl.disable(gl.BLEND);
  }

  step(fingertips: FingertipState[]) {
    if (!this.velocity) return;
    // Fixed timestep. Real RAF dt varies 16–33ms; advection is dt-sensitive
    // so variable dt shows up as visible pulsing. Fixed dt = steady sim.
    const dt = 1 / 60;
    this.advect(dt);

    const a = this.params.fingerVelSmoothing;
    const fScale = this.params.splatForce;
    const activeIds = new Set<string>();

    for (const f of fingertips) {
      activeIds.add(f.id);
      let smooth = this.smoothMap.get(f.id);
      if (!smooth) {
        smooth = { vx: 0, vy: 0 };
        this.smoothMap.set(f.id, smooth);
      }
      smooth.vx = smooth.vx * (1 - a) + f.vx * a;
      smooth.vy = smooth.vy * (1 - a) + f.vy * a;

      // Input y=0 at top of screen; GL texture y=0 at bottom.
      // Splat position uses (1 - f.y) and force y is negated.
      const fx = smooth.vx * this.gridW * fScale * 0.001;
      const fy = -smooth.vy * this.gridH * fScale * 0.001;
      this.splat(f.x, 1 - f.y, fx, fy);
      // Collider moves at the fingertip's smoothed velocity.
      const dvx = smooth.vx * this.gridW;
      const dvy = -smooth.vy * this.gridH;
      this.applyCollider(f.x, 1 - f.y, dvx, dvy);
    }

    // Evict smoothing state for fingers that departed.
    for (const id of this.smoothMap.keys()) {
      if (!activeIds.has(id)) this.smoothMap.delete(id);
    }

    this.computeDivergence();
    this.solvePressure();
    this.project();
    this.updateGlow(dt);
    this.updateWarp(dt);
    this.updateFish(dt, fingertips);
    this.elapsed += dt;
  }

  render() {
    if (!this.glow || !this.warp) return;
    const gl = this.gl;

    // Pass 1: ocean surface (Gerstner + sky/sun reflection + warp-driven
    // disturbance) — opaque, clears canvas implicitly.
    gl.disable(gl.BLEND);
    gl.useProgram(this.progSurfaceDisplay);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.warp.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progSurfaceDisplay, 'uWarp'), 0);
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uTime'),
      this.elapsed,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uAspect'),
      this.displayW / this.displayH,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uWaveAmplitude'),
      this.surfaceParams.waveAmplitude,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uWaveSpeed'),
      this.surfaceParams.waveSpeed,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uWaveScale'),
      this.surfaceParams.waveScale,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uDisturbStrength'),
      this.surfaceParams.disturbStrength,
    );
    gl.uniform3f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uWaterBase'),
      0.01,
      0.04,
      0.08,
    );
    gl.uniform3f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uSkyZenith'),
      0.02,
      0.08,
      0.15,
    );
    gl.uniform3f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uSkyHorizon'),
      0.15,
      0.25,
      0.4,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uSunPos'),
      this.surfaceParams.sunPosX,
      this.surfaceParams.sunPosY,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uSunRadius'),
      this.surfaceParams.sunRadius,
    );
    gl.uniform3f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uSunColor'),
      1.0,
      0.95,
      0.85,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uSunBrightness'),
      this.surfaceParams.sunBrightness,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.progSurfaceDisplay, 'uFresnelExp'),
      this.surfaceParams.fresnelExp,
    );
    this.draw(null);

    // Pass 2: fish trail additively composited (bioluminescent swarm
    // under the surface).
    if (this.fishTrail) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.progFishComposite);
      gl.bindVertexArray(this.quad);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fishTrail.read.tex);
      gl.uniform1i(
        gl.getUniformLocation(this.progFishComposite, 'uTrail'),
        0,
      );
      gl.uniform1f(
        gl.getUniformLocation(this.progFishComposite, 'uStrength'),
        this.fishParams.composite,
      );
      this.draw(null);
    }

    // Pass 3: finger-driven bioluminescent glow (vorticity) additively
    // blended on top. Navy ends blend into the dark water; cyan pops.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.progGlowDisplay);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glow.read.tex);
    gl.uniform1i(gl.getUniformLocation(this.progGlowDisplay, 'uGlow'), 0);
    gl.uniform1f(
      gl.getUniformLocation(this.progGlowDisplay, 'uBrightness'),
      this.glowParams.brightness,
    );
    this.draw(null);
    gl.disable(gl.BLEND);
  }

  dispose() {
    const gl = this.gl;
    if (this.velocity) {
      destroyFBO(gl, this.velocity.read);
      destroyFBO(gl, this.velocity.write);
    }
    if (this.divergence) destroyFBO(gl, this.divergence);
    if (this.pressure) {
      destroyFBO(gl, this.pressure.read);
      destroyFBO(gl, this.pressure.write);
    }
    if (this.glow) {
      destroyFBO(gl, this.glow.read);
      destroyFBO(gl, this.glow.write);
    }
    if (this.warp) {
      destroyFBO(gl, this.warp.read);
      destroyFBO(gl, this.warp.write);
    }
    if (this.fishTrail) {
      destroyFBO(gl, this.fishTrail.read);
      destroyFBO(gl, this.fishTrail.write);
    }
    gl.deleteProgram(this.progSplat);
    gl.deleteProgram(this.progAdvect);
    gl.deleteProgram(this.progCollider);
    gl.deleteProgram(this.progDivergence);
    gl.deleteProgram(this.progPressure);
    gl.deleteProgram(this.progProject);
    gl.deleteProgram(this.progGlowUpdate);
    gl.deleteProgram(this.progGlowDisplay);
    gl.deleteProgram(this.progWarpUpdate);
    gl.deleteProgram(this.progSurfaceDisplay);
    gl.deleteProgram(this.progFish);
    gl.deleteProgram(this.progFishDecay);
    gl.deleteProgram(this.progFishComposite);
    gl.deleteBuffer(this.fishBuffer);
    gl.deleteVertexArray(this.fishVao);
    gl.deleteVertexArray(this.quad);
  }
}
