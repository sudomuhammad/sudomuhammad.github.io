// A question from the ask bar, drawn as a bright particle that launches from the bar
// and settles among its best matches, with a line to each.
import type { ParticleSystem } from './particles';

// How strongly the question is drawn to each match, best first.
const WEIGHTS = [0.55, 0.28, 0.17];
const PULL = 0.02;
const DAMPING = 0.84;
const LINES_MS = 900; // the links to its matches draw out over this long
// With one match, sit just above it rather than on top of it.
const SINGLE_OFFSET = 22; // px

export interface QueryStyle {
  colors: string[];
  ink: string;
  ground: string;
}

export class QueryParticle {
  private active = false;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  /** Anchor indices of the matches, best first. */
  private targets: number[] = [];
  private born = 0;

  constructor(private readonly particles: ParticleSystem) {}

  /**
   * Point the question at these anchors. It launches from `from` (canvas pixels) with a small
   * upward kick, or appears at its destination with reduced motion or no origin. A question
   * already on screen glides on to its new matches.
   */
  show(targets: number[], from: { x: number; y: number } | undefined, reducedMotion: boolean): void {
    if (!targets.length) {
      this.active = false;
      return;
    }
    this.targets = targets;
    this.born = performance.now();
    const instant = reducedMotion || !from;
    if (instant || !this.active) {
      [this.x, this.y] = instant ? this.destination() : [from.x, from.y];
      this.vx = 0;
      this.vy = instant ? 0 : -6;
    }
    this.active = true;
  }

  step(): void {
    if (!this.active) return;
    const [tx, ty] = this.destination();
    this.vx = (this.vx + (tx - this.x) * PULL) * DAMPING;
    this.vy = (this.vy + (ty - this.y) * PULL) * DAMPING;
    this.x += this.vx;
    this.y += this.vy;
  }

  draw(ctx: CanvasRenderingContext2D, style: QueryStyle, still: boolean): void {
    if (!this.active) return;
    const { x, y, slot } = this.particles;
    const reveal = still ? 1 : Math.min(1, (performance.now() - this.born) / LINES_MS);
    this.targets.forEach((a, rank) => {
      ctx.globalAlpha = reveal * (rank === 0 ? 0.9 : 0.55);
      ctx.strokeStyle = style.colors[slot[a]];
      ctx.lineWidth = rank === 0 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + (x[a] - this.x) * reveal, this.y + (y[a] - this.y) * reveal);
      ctx.stroke();
    });
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = style.ink;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = style.ink;
    ctx.fill();
    ctx.strokeStyle = style.ground;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Where the question settles: a weighted centre of its matches. */
  private destination(): [number, number] {
    const { x, y } = this.particles;
    let tx = 0;
    let ty = 0;
    let total = 0;
    this.targets.forEach((a, rank) => {
      const w = WEIGHTS[rank] ?? 0.1;
      tx += x[a] * w;
      ty += y[a] * w;
      total += w;
    });
    return [tx / total, ty / total - (this.targets.length === 1 ? SINGLE_OFFSET : 0)];
  }
}
