import type { FingertipState } from '../hands/useHandLandmarker';
import type { FishParams } from './params';

// CPU boids with per-fish depth. Coordinates in normalized [0,1] UV with
// y=0 at top, matching the fingertip convention used everywhere else.
// Velocity in UV/second. Naive O(N²) — fine for a few hundred fish.
export class Boids {
  private px: Float32Array;
  private py: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private depth: Float32Array;
  private depthVel: Float32Array;
  // Interleaved GL upload buffer: [x, y, depth, speed] per fish.
  private interleaved: Float32Array;
  private _count: number;

  constructor(count: number) {
    this._count = count;
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.depth = new Float32Array(count);
    this.depthVel = new Float32Array(count);
    this.interleaved = new Float32Array(count * 4);
    this.seed();
  }

  get count() {
    return this._count;
  }

  get buffer(): Float32Array {
    return this.interleaved;
  }

  resize(count: number) {
    if (count === this._count) return;
    this._count = count;
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.depth = new Float32Array(count);
    this.depthVel = new Float32Array(count);
    this.interleaved = new Float32Array(count * 4);
    this.seed();
  }

  private seed() {
    for (let i = 0; i < this._count; i++) {
      this.px[i] = Math.random();
      this.py[i] = Math.random();
      const a = Math.random() * Math.PI * 2;
      const s = 0.02 + Math.random() * 0.05;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.depth[i] = Math.random();
      this.depthVel[i] = (Math.random() - 0.5) * 0.02;
    }
  }

  update(dt: number, fingertips: FingertipState[], p: FishParams) {
    const n = this._count;
    const neighborR2 = p.neighborRadius * p.neighborRadius;
    const sepR2 = p.separationRadius * p.separationRadius;
    const repR = p.repulsionRadius;
    const repR2 = repR * repR;

    // Scratch force arrays — reuse allocations across frames.
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      let ax = 0;
      let ay = 0;
      let cx = 0;
      let cy = 0;
      let sx = 0;
      let sy = 0;
      let neighborCount = 0;
      const ixi = this.px[i];
      const iyi = this.py[i];

      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = this.px[j] - ixi;
        const dy = this.py[j] - iyi;
        const d2 = dx * dx + dy * dy;
        if (d2 < neighborR2) {
          neighborCount++;
          ax += this.vx[j];
          ay += this.vy[j];
          cx += this.px[j];
          cy += this.py[j];
          if (d2 < sepR2 && d2 > 1e-8) {
            const w = 1.0 / Math.sqrt(d2);
            sx -= dx * w;
            sy -= dy * w;
          }
        }
      }

      if (neighborCount > 0) {
        ax = ax / neighborCount - this.vx[i];
        ay = ay / neighborCount - this.vy[i];
        cx = cx / neighborCount - ixi;
        cy = cy / neighborCount - iyi;
      }

      fx[i] =
        ax * p.alignWeight +
        cx * p.cohesionWeight +
        sx * p.separationWeight;
      fy[i] =
        ay * p.alignWeight +
        cy * p.cohesionWeight +
        sy * p.separationWeight;

      // Fingertip repulsion — each finger pushes radially with falloff.
      for (const f of fingertips) {
        const dx = ixi - f.x;
        const dy = iyi - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < repR2 && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const falloff = 1.0 - d / repR;
          const mag = (p.repulsionStrength * falloff * falloff) / d;
          fx[i] += dx * mag;
          fy[i] += dy * mag;
        }
      }
    }

    // Integrate velocity and position with damping and speed cap.
    const damp = Math.pow(p.damping, dt * 60);
    const maxS2 = p.maxSpeed * p.maxSpeed;
    for (let i = 0; i < n; i++) {
      this.vx[i] = (this.vx[i] + fx[i] * dt) * damp;
      this.vy[i] = (this.vy[i] + fy[i] * dt) * damp;
      const s2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
      if (s2 > maxS2) {
        const k = p.maxSpeed / Math.sqrt(s2);
        this.vx[i] *= k;
        this.vy[i] *= k;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      // Wrap around edges — swarm never exits the frame.
      if (this.px[i] < 0) this.px[i] += 1;
      else if (this.px[i] > 1) this.px[i] -= 1;
      if (this.py[i] < 0) this.py[i] += 1;
      else if (this.py[i] > 1) this.py[i] -= 1;

      // Depth drift — each fish slowly oscillates in depth.
      this.depthVel[i] += (Math.random() - 0.5) * p.depthDrift * dt;
      this.depthVel[i] *= 0.95;
      this.depth[i] += this.depthVel[i] * dt;
      if (this.depth[i] < 0) {
        this.depth[i] = 0;
        this.depthVel[i] = Math.abs(this.depthVel[i]);
      } else if (this.depth[i] > 1) {
        this.depth[i] = 1;
        this.depthVel[i] = -Math.abs(this.depthVel[i]);
      }
    }

    // Pack interleaved buffer for GL upload.
    const buf = this.interleaved;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      buf[k + 0] = this.px[i];
      buf[k + 1] = this.py[i];
      buf[k + 2] = this.depth[i];
      buf[k + 3] = Math.sqrt(this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i]);
    }
  }
}
