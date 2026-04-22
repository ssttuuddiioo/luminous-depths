// One Euro Filter — Casiez, Roussel, Vogel 2012.
// Adaptive low-pass: smooths noise when slow, lets fast motion through.

class LowPass {
  private s: number | null = null;
  filter(x: number, alpha: number): number {
    if (this.s == null) {
      this.s = x;
      return x;
    }
    this.s = alpha * x + (1 - alpha) * this.s;
    return this.s;
  }
  reset() {
    this.s = null;
  }
}

function alphaFor(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  private xLP = new LowPass();
  private dxLP = new LowPass();
  private lastT: number | null = null;
  private lastX: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(x: number, tMs: number): number {
    const t = tMs / 1000;
    const dt = this.lastT != null ? Math.max(t - this.lastT, 1e-3) : 1 / 60;
    this.lastT = t;
    const dx = this.lastX != null ? (x - this.lastX) / dt : 0;
    this.lastX = x;
    const edx = this.dxLP.filter(dx, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xLP.filter(x, alphaFor(cutoff, dt));
  }

  reset() {
    this.xLP.reset();
    this.dxLP.reset();
    this.lastT = null;
    this.lastX = null;
  }
}
