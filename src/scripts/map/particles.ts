// Particle storage and physics. Every particle springs towards its "home";
// the stage moves homes to animate scene changes.
import { gaussian, type Random } from './random';

export interface Seed {
  /** Map units. */
  x: number;
  y: number;
  /** Colour slot. */
  slot: number;
}

export interface Pointer {
  x: number;
  y: number;
  active: boolean;
}

const DAMPING = 0.86;
const POINTER_RADIUS = { phone: 60, desktop: 96 };
const POINTER_FORCE = { anchor: 0.6, cloud: 2.4 }; // anchors resist so they stay hoverable

/**
 * Particles in struct-of-arrays layout (fast to iterate and to upload to WebGL).
 * The first `anchorCount` are anchors (passages and skills); the rest are cloud.
 */
export class ParticleSystem {
  readonly count: number;
  readonly anchorCount: number;
  /** Positions in map units, fixed. */
  readonly baseX: Float32Array;
  readonly baseY: Float32Array;
  /** Where each particle is heading, in pixels. */
  readonly homeX: Float32Array;
  readonly homeY: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly slot: Int16Array;

  /**
   * @param anchors one particle each (passages, then skill labels)
   * @param cloudPerAnchor how many cloud particles to scatter around each of the first `cloudSources` anchors
   * @param noise extra particles spread over the whole map in `noiseSlot`
   */
  constructor(
    anchors: Seed[],
    { cloudSources, cloudPerAnchor, spread, noise, noiseSlot }: {
      cloudSources: number;
      cloudPerAnchor: number;
      spread: number;
      noise: number;
      noiseSlot: number;
    },
    random: Random,
  ) {
    this.anchorCount = anchors.length;
    this.count = anchors.length + cloudSources * cloudPerAnchor + noise;
    const make = () => new Float32Array(this.count);
    this.baseX = make();
    this.baseY = make();
    this.homeX = make();
    this.homeY = make();
    this.x = make();
    this.y = make();
    this.vx = make();
    this.vy = make();
    this.slot = new Int16Array(this.count);

    let i = 0;
    const put = (x: number, y: number, slot: number) => {
      this.baseX[i] = x;
      this.baseY[i] = y;
      this.slot[i++] = slot;
    };
    for (const a of anchors) put(a.x, a.y, a.slot);
    for (const a of anchors.slice(0, cloudSources)) {
      for (let k = 0; k < cloudPerAnchor; k++) put(a.x + gaussian(random) * spread, a.y + gaussian(random) * spread, a.slot);
    }
    while (i < this.count) put(random() * 1.2 - 0.1, random() * 1.2 - 0.1, noiseSlot);
  }

  /**
   * Advance one frame. `stiffness` ramps up during the intro so noise settles into clusters.
   * `jitter` keeps the cloud alive; anchors don't get it, because labels are drawn on them.
   */
  step(stiffness: number, jitter: number, pointer: Pointer, phone: boolean): void {
    const radius = phone ? POINTER_RADIUS.phone : POINTER_RADIUS.desktop;
    const r2 = radius * radius;
    for (let p = 0; p < this.count; p++) {
      let ax = (this.homeX[p] - this.x[p]) * stiffness;
      let ay = (this.homeY[p] - this.y[p]) * stiffness;
      if (pointer.active) {
        const dx = this.x[p] - pointer.x;
        const dy = this.y[p] - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d / radius) ** 2 * (p < this.anchorCount ? POINTER_FORCE.anchor : POINTER_FORCE.cloud);
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
      if (p >= this.anchorCount) {
        ax += (Math.random() - 0.5) * jitter;
        ay += (Math.random() - 0.5) * jitter;
      }
      this.vx[p] = (this.vx[p] + ax) * DAMPING;
      this.vy[p] = (this.vy[p] + ay) * DAMPING;
      this.x[p] += this.vx[p];
      this.y[p] += this.vy[p];
    }
  }

  /** Jump straight to the homes (reduced motion). */
  settle(): void {
    this.x.set(this.homeX);
    this.y.set(this.homeY);
    this.vx.fill(0);
    this.vy.fill(0);
  }

  /** Scatter uniformly over a width × height area, at rest. */
  scatter(width: number, height: number, random: Random): void {
    for (let p = 0; p < this.count; p++) {
      this.x[p] = random() * width;
      this.y[p] = random() * height;
    }
    this.vx.fill(0);
    this.vy.fill(0);
  }

  /** Put every particle on one of `origins` with an outward kick: the intro burst. */
  burst(origins: { x: number; y: number }[], random: Random): void {
    for (let p = 0; p < this.count; p++) {
      const o = origins[p % origins.length];
      const angle = random() * Math.PI * 2;
      const speed = 2 + random() * 6;
      this.x[p] = o.x + Math.cos(angle) * 6;
      this.y[p] = o.y + Math.sin(angle) * 6;
      this.vx[p] = Math.cos(angle) * speed;
      this.vy[p] = Math.sin(angle) * speed;
    }
  }
}
