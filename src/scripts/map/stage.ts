// The full-screen map that stays on stage for the whole story. Chapters drive it
// with declarative scenes (camera, focus, highlights, labels, particle text). A scene change only moves each particle's home; the physics
// turns it into motion.
import type { Cluster, Label, MappedPassage } from '../../data/map';
import { createGlCloud, type GlCloud } from './gl-cloud';
import { LabelLayer, type LabelItem } from './label-layer';
import { ParticleSystem, type Pointer } from './particles';
import { seededRandom, shufflePairs } from './random';
import { sampleText } from './text-sampler';

/** Something the visitor can point at: a CV passage or a skill label. */
export type Anchor = { type: 'passage'; passage: MappedPassage } | { type: 'label'; label: Label };

/** In map units (the unit square UMAP produced). Zoom 1 fits the whole map in the viewport. */
export interface Camera {
  cx: number;
  cy: number;
  zoom: number;
  /** Move the picture sideways by this fraction of the viewport width, to clear a card. */
  shift: number;
}

export type LabelMode =
  | { kind: 'overview' } // passage titles; skills too on wide screens
  | { kind: 'focus' } // the focused clusters' titles and skills
  | { kind: 'terms'; terms: string[] } // just these skills
  | { kind: 'none' };

export interface Scene {
  camera: Camera;
  /** Cluster ids to light; others dim. null lights everything. */
  focus: number[] | null;
  /** Passage ids and skill terms to ring. */
  lit: number[];
  litTerms: string[];
  labels: LabelMode;
  /** Re-form the cloud into these lines of text. */
  text: string[] | null;
  /** Overall opacity of the map, e.g. low behind the intro headline. */
  fade: number;
}

export const OVERVIEW: Scene = {
  camera: { cx: 0.5, cy: 0.5, zoom: 1, shift: 0 },
  focus: null,
  lit: [],
  litTerms: [],
  labels: { kind: 'overview' },
  text: null,
  fade: 1,
};

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Options {
  canvas: HTMLCanvasElement;
  clusters: Cluster[];
  passages: MappedPassage[];
  labels: Label[];
  /** Screen space kept clear of the map (top bar, ask bar). */
  insets: () => Insets;
  onHover?: (anchor: Anchor | null, x: number, y: number) => void;
  /** Stay empty until burstFrom() (the token intro), with a timeout fallback. */
  waitForIntro?: boolean;
}

const SANS = "'Bricolage Grotesque Variable', 'Helvetica Neue', Arial, sans-serif";
const CLOUD_SPREAD = 0.02; // map units
const NOISE_SHARE = 0.05;
const DIMMED = 0.14;
const HOVER_RADIUS = 18; // px
const INTRO_FALLBACK_MS = 3000;
const QUERY_WEIGHTS = [0.55, 0.28, 0.17];
// Cloud points in css px: WebGL draws soft discs; the Canvas fallback draws small squares.
const CLOUD_POINT = { gl: 3.2, canvas: { narrow: 1.7, wide: 1.9 } };
// Particle text points are sized from the sampling spacing (a little under it) so dots stay
// distinct: large desktop text keeps ~2.4px dots, small narrow-screen text gets finer ones.
const TEXT_POINT = { max: 2.4, min: 1, ofSpacing: 0.8 };
// Whenever the particles take a new shape (the intro burst into the map, the map into the
// email and back), springs start loose and tighten with an ease-in-out: the cloud drifts in
// and the shape sharpens at the end. At 60fps it reads by ~1.3s and settles by ~1.5s.
// Afterwards springs stay at `end`, which also drives camera moves between scenes.
const FORMATION = { start: 0.001, end: 0.015, ms: 2000 };
const TEXT_DENSITY = 34; // sample points per character height

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ringed = (kind: MappedPassage['kind']) => kind !== 'tools' && kind !== 'skills';

export class MapStage {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly gl: GlCloud | null;
  private readonly glCanvas = document.createElement('canvas');
  private readonly particles: ParticleSystem;
  private readonly labelLayer: LabelLayer;
  private readonly random = seededRandom(1994);
  private readonly colors: string[]; // by slot; the last is noise
  private readonly theme = { ink: css('--ink'), ground: css('--ground'), grid: css('--grid') };
  private readonly media = {
    reduce: matchMedia('(prefers-reduced-motion: reduce)'),
    narrow: matchMedia('(max-width: 959px)'),
    wide: matchMedia('(min-width: 1600px)'),
  };

  private readonly slotOf: Map<number, number>;
  private readonly anchorOf: Map<number, number>; // passage id -> anchor index
  private readonly alpha: Float32Array;
  private readonly glAlpha: Float32Array;
  private readonly pointer: Pointer = { x: -9999, y: -9999, active: false };

  private width = 0;
  private height = 0;
  private dpr = 1;
  private grid: HTMLCanvasElement | null = null;
  private scene: Scene = OVERVIEW;
  private focusSlots: Set<number> | null = null;
  private litAnchors = new Set<number>();
  private textTargets: Float32Array | null = null;
  private textPointSize: number = TEXT_POINT.max;
  private hovered: number | null = null;
  private query = { active: false, x: 0, y: 0, vx: 0, vy: 0, targets: [] as number[], born: 0 };
  /** When the particles last started forming a new shape; see FORMATION. */
  private formStarted = performance.now();
  private revealed: boolean;
  private running = false;

  constructor(private readonly options: Options) {
    const { canvas, clusters, passages, labels } = options;
    this.ctx = canvas.getContext('2d')!;
    this.labelLayer = new LabelLayer(this.ctx);
    this.colors = [...clusters.map((c) => c.color), css('--noise')];
    this.slotOf = new Map(clusters.map((c, i) => [c.id, i]));
    this.anchorOf = new Map(passages.map((p, i) => [p.id, i]));
    this.alpha = new Float32Array(this.colors.length).fill(1);
    this.glAlpha = new Float32Array(this.colors.length);

    // WebGL draws the cloud when available, which affords about four times as many particles.
    this.glCanvas.className = 'map-gl';
    this.glCanvas.setAttribute('aria-hidden', 'true');
    this.gl = createGlCloud(this.glCanvas, this.colors, 16000);
    if (this.gl) canvas.before(this.glCanvas);
    const narrow = this.media.narrow.matches;
    const budget = this.gl ? (narrow ? 5000 : 12000) : narrow ? 1400 : 3000;

    this.particles = new ParticleSystem(
      [
        ...passages.map((p) => ({ x: p.x, y: p.y, slot: this.slotOf.get(p.cluster)! })),
        ...labels.map((l) => ({ x: l.x, y: l.y, slot: this.slotOf.get(l.cluster)! })),
      ],
      {
        cloudSources: passages.length,
        cloudPerAnchor: Math.max(8, Math.floor((budget * (1 - NOISE_SHARE)) / passages.length)),
        spread: CLOUD_SPREAD,
        noise: Math.round(budget * NOISE_SHARE),
        noiseSlot: clusters.length,
      },
      this.random,
    );

    this.revealed = !options.waitForIntro || this.media.reduce.matches;
    this.listen();
    this.resize();
    if (!this.revealed) setTimeout(() => this.reveal(), INTRO_FALLBACK_MS);
    if (this.media.reduce.matches) this.renderStill();
    else {
      this.particles.scatter(this.width, this.height, this.random);
      this.play();
    }
  }

  // ------------------------------------------------------------------ public API

  /** Move to a scene. Everything not set by the scene returns to the overview. */
  apply(scene: Scene): void {
    const textChanged = scene.text?.join('\n') !== this.scene.text?.join('\n');
    this.scene = scene;
    this.focusSlots = scene.focus ? new Set(scene.focus.map((id) => this.slotOf.get(id)!)) : null;
    this.litAnchors = new Set(scene.lit.map((id) => this.anchorOf.get(id)).filter((a) => a !== undefined));
    if (textChanged) {
      this.textTargets = scene.text ? this.sampleText(scene.text) : null;
      this.formStarted = performance.now();
    }
    this.setHovered(null);
    this.computeHomes();
    if (this.media.reduce.matches) this.renderStill();
  }

  /** A camera that frames the given passages and skill labels, `shift` leaving room for a card. */
  frame({ passages = [], terms = [] }: { passages?: number[]; terms?: string[] }, shift = 0): Camera {
    const points = [
      ...passages.map((id) => this.options.passages[this.anchorOf.get(id) ?? -1]),
      ...this.options.labels.filter((l) => terms.includes(l.term)),
    ].filter(Boolean);
    if (!points.length) return { ...OVERVIEW.camera, shift };
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const span = Math.max(0.08, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return {
      cx: (Math.max(...xs) + Math.min(...xs)) / 2,
      cy: (Math.max(...ys) + Math.min(...ys)) / 2,
      zoom: Math.min(2.6, 0.55 / span),
      shift,
    };
  }

  /** Show a question as a particle that launches from `from` and settles among its matches. */
  ask(passageIds: number[] | null, from?: { x: number; y: number }): void {
    const targets = (passageIds ?? []).map((id) => this.anchorOf.get(id)).filter((a) => a !== undefined);
    const q = this.query;
    if (!targets.length) {
      q.active = false;
      return this.redrawIfIdle();
    }
    q.targets = targets;
    q.born = performance.now();
    const instant = this.media.reduce.matches || !from;
    if (instant || !q.active) {
      [q.x, q.y] = instant ? this.queryTarget() : [from.x, from.y];
      q.vx = 0;
      q.vy = instant ? 0 : -6; // a small upward kick off the bar
    }
    q.active = true;
    this.redrawIfIdle();
  }

  /** Launch every particle from these points (canvas pixels) and let them settle: the intro. */
  burstFrom(points: { x: number; y: number }[]): void {
    if (points.length && !this.media.reduce.matches) {
      this.particles.burst(points, this.random);
      this.formStarted = performance.now();
    }
    this.reveal(false);
  }

  // ------------------------------------------------------------------ geometry

  private viewport() {
    const i = this.options.insets();
    return { left: i.left, top: i.top, width: this.width - i.left - i.right, height: this.height - i.top - i.bottom };
  }

  /** Map units -> screen pixels. UMAP normalises its axes separately, so each fits its own side. */
  private project(u: number, v: number): [number, number] {
    const vp = this.viewport();
    const { cx, cy, zoom, shift } = this.scene.camera;
    return [
      vp.left + vp.width / 2 + shift * this.width + (u - cx) * vp.width * 0.92 * zoom,
      vp.top + vp.height / 2 + (v - cy) * vp.height * 0.88 * zoom,
    ];
  }

  private computeHomes(): void {
    const p = this.particles;
    const targets = this.textTargets;
    for (let i = 0; i < p.count; i++) {
      if (targets && i >= p.anchorCount) {
        const t = ((i - p.anchorCount) % (targets.length / 2)) * 2;
        p.homeX[i] = targets[t];
        p.homeY[i] = targets[t + 1];
      } else {
        [p.homeX[i], p.homeY[i]] = this.project(p.baseX[i], p.baseY[i]);
      }
    }
  }

  private sampleText(lines: string[]): Float32Array {
    const vp = this.viewport();
    const rect = { left: vp.left, top: vp.top, width: vp.width, height: vp.height };
    const cloud = this.particles.count - this.particles.anchorCount;
    const { points, spacing } = sampleText(lines, rect, { family: SANS, density: TEXT_DENSITY, maxPoints: cloud });
    this.textPointSize = Math.min(TEXT_POINT.max, Math.max(TEXT_POINT.min, spacing * TEXT_POINT.ofSpacing));
    // Shuffle so neighbouring particles don't all race to neighbouring targets.
    return shufflePairs(points, this.random);
  }

  // ------------------------------------------------------------------ loop

  private play(): void {
    if (this.running || this.media.reduce.matches || document.hidden) return;
    this.running = true;
    const frame = (now: number) => {
      if (!this.running) return;
      this.step(now);
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private pause(): void {
    this.running = false;
  }

  private reveal(fromNoise = true): void {
    if (this.revealed) return;
    this.revealed = true;
    if (fromNoise) {
      this.particles.scatter(this.width, this.height, this.random);
      this.formStarted = performance.now();
    }
    if (this.media.reduce.matches) this.renderStill();
    else this.play();
  }

  private targetAlpha(slot: number): number {
    if (this.textTargets) return 1;
    const base = !this.focusSlots ? (slot === this.colors.length - 1 ? 0.8 : 1) : this.focusSlots.has(slot) ? 1 : DIMMED;
    return base * this.scene.fade;
  }

  private step(now: number): void {
    this.particles.step(this.stiffness(now), this.textTargets ? 0.04 : 0.12, this.pointer, this.media.narrow.matches);
    for (let s = 0; s < this.alpha.length; s++) this.alpha[s] += (this.targetAlpha(s) - this.alpha[s]) * 0.1;
    this.stepQuery();
  }

  /** Spring stiffness for this frame, following the FORMATION curve since the last new shape. */
  private stiffness(now: number): number {
    const t = Math.min(1, (now - this.formStarted) / FORMATION.ms);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // ease-in-out cubic
    return FORMATION.start + (FORMATION.end - FORMATION.start) * eased;
  }

  private stepQuery(): void {
    const q = this.query;
    if (!q.active) return;
    const [tx, ty] = this.queryTarget();
    q.vx = (q.vx + (tx - q.x) * 0.02) * 0.84;
    q.vy = (q.vy + (ty - q.y) * 0.02) * 0.84;
    q.x += q.vx;
    q.y += q.vy;
  }

  /** Where the question settles: a weighted centre of its matches. */
  private queryTarget(): [number, number] {
    const { x, y } = this.particles;
    let tx = 0;
    let ty = 0;
    let total = 0;
    this.query.targets.forEach((a, rank) => {
      const w = QUERY_WEIGHTS[rank] ?? 0.1;
      tx += x[a] * w;
      ty += y[a] * w;
      total += w;
    });
    return [tx / total, ty / total - (this.query.targets.length === 1 ? 22 : 0)];
  }

  private renderStill(): void {
    this.computeHomes();
    this.particles.settle();
    for (let s = 0; s < this.alpha.length; s++) this.alpha[s] = this.targetAlpha(s);
    this.draw();
  }

  private redrawIfIdle(): void {
    if (!this.running) this.draw();
  }

  // ------------------------------------------------------------------ drawing

  private draw(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.grid) ctx.drawImage(this.grid, 0, 0, this.width, this.height);
    if (!this.revealed) return this.gl?.clear();
    this.drawCloud();
    if (this.textTargets) return; // particle text: nothing else on screen
    this.drawAnchors();
    this.drawQuery();
    this.labelLayer.draw(
      this.labelItems(),
      { family: SANS, ink: this.theme.ink, halo: this.theme.ground },
      { width: this.width, height: this.height },
    );
  }

  private drawCloud(): void {
    const { particles: p, ctx, alpha } = this;
    const noise = this.colors.length - 1;
    // Text gets full strength: its dots are finer than the cloud's, so they carry less ink.
    const strength = this.textTargets ? 1 : 0.78;
    const opacity = (s: number) => alpha[s] * (s === noise ? 0.6 : strength);
    if (this.gl) {
      for (let s = 0; s < alpha.length; s++) this.glAlpha[s] = opacity(s);
      const size = this.textTargets ? this.textPointSize : CLOUD_POINT.gl;
      return this.gl.draw(p.x, p.y, p.slot, p.anchorCount, p.count, this.glAlpha, size);
    }
    const size = this.textTargets
      ? this.textPointSize
      : CLOUD_POINT.canvas[this.media.narrow.matches ? 'narrow' : 'wide'];
    for (let s = 0; s < alpha.length; s++) {
      ctx.globalAlpha = opacity(s);
      ctx.fillStyle = this.colors[s];
      ctx.beginPath();
      for (let i = p.anchorCount; i < p.count; i++) {
        if (p.slot[i] === s) ctx.rect(p.x[i] - size / 2, p.y[i] - size / 2, size, size);
      }
      ctx.fill();
    }
  }

  private isPassage(a: number) {
    return a < this.options.passages.length;
  }

  private isLit(a: number) {
    return this.isPassage(a)
      ? this.litAnchors.has(a)
      : this.scene.litTerms.includes(this.options.labels[a - this.options.passages.length].term);
  }

  private drawAnchors(): void {
    const { ctx, particles: p } = this;
    for (let a = 0; a < p.anchorCount; a++) {
      const color = this.colors[p.slot[a]];
      const lit = this.isLit(a) || this.hovered === a;
      ctx.globalAlpha = Math.max(this.alpha[p.slot[a]], lit ? 1 : 0);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x[a], p.y[a], lit ? 5 : this.isPassage(a) ? 3.6 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      if (this.isPassage(a)) {
        ctx.strokeStyle = this.theme.ground; // passages read as rings
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (lit) this.ring(p.x[a], p.y[a], 10, color);
    }
  }

  private ring(x: number, y: number, radius: number, color: string, fill?: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawQuery(): void {
    const q = this.query;
    if (!q.active) return;
    const { ctx, particles: p } = this;
    const reveal = this.media.reduce.matches ? 1 : Math.min(1, (performance.now() - q.born) / 900);
    q.targets.forEach((a, rank) => {
      ctx.globalAlpha = reveal * (rank === 0 ? 0.9 : 0.55);
      ctx.strokeStyle = this.colors[p.slot[a]];
      ctx.lineWidth = rank === 0 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x + (p.x[a] - q.x) * reveal, q.y + (p.y[a] - q.y) * reveal);
      ctx.stroke();
    });
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = this.theme.ink;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.ring(q.x, q.y, 5.5, this.theme.ground, this.theme.ink);
  }

  /** Which names to show, and how strongly, under the scene's label mode. */
  private labelItems(): LabelItem[] {
    const { passages, labels } = this.options;
    const { x, y, slot, anchorCount } = this.particles;
    const mode = this.scene.labels;
    const narrow = this.media.narrow.matches;
    const base = narrow ? 11 : 12.5;
    const items: LabelItem[] = [];
    for (let a = 0; a < anchorCount; a++) {
      const passage = this.isPassage(a) ? passages[a] : null;
      const term = passage ? null : labels[a - passages.length].term;
      const titled = passage !== null && ringed(passage.kind);
      const inFocus = !this.focusSlots || this.focusSlots.has(slot[a]);
      const force = this.hovered === a || this.isLit(a);

      let rank: number | null = force ? 0 : null;
      if (rank === null) {
        if (mode.kind === 'terms') rank = term && mode.terms.includes(term) ? 1 : null;
        else if (mode.kind === 'focus') rank = inFocus && (titled || term) ? (titled ? 1 : 2) : null;
        else if (mode.kind === 'overview' && !narrow) rank = titled ? 2 : term && this.media.wide.matches ? 3 : null;
      }
      if (rank === null || (!titled && !term)) continue;

      const strong = rank <= 1;
      items.push({
        x: x[a],
        y: y[a],
        text: passage ? passage.title : term!,
        rank,
        force,
        size: passage ? base : base - 1,
        weight: strong ? 650 : passage ? 600 : 500,
        alpha: strong ? 1 : this.alpha[slot[a]] * (passage ? 0.92 : 0.7),
      });
    }
    return items;
  }

  // ------------------------------------------------------------------ input and lifecycle

  private nearestAnchor(px: number, py: number): number | null {
    if (this.textTargets) return null;
    const { x, y, slot, anchorCount } = this.particles;
    let best: number | null = null;
    let bestD = HOVER_RADIUS * HOVER_RADIUS;
    for (let a = 0; a < anchorCount; a++) {
      if (this.focusSlots && !this.focusSlots.has(slot[a])) continue;
      const d = (x[a] - px) ** 2 + (y[a] - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  private setHovered(index: number | null): void {
    if (index === this.hovered) return;
    this.hovered = index;
    const { passages, labels, onHover } = this.options;
    if (index === null) onHover?.(null, 0, 0);
    else {
      const anchor: Anchor = this.isPassage(index)
        ? { type: 'passage', passage: passages[index] }
        : { type: 'label', label: labels[index - passages.length] };
      onHover?.(anchor, this.particles.x[index], this.particles.y[index]);
    }
    this.redrawIfIdle();
  }

  private listen(): void {
    const { canvas } = this.options;
    canvas.addEventListener('pointermove', (e) => {
      Object.assign(this.pointer, { x: e.clientX, y: e.clientY, active: e.pointerType === 'mouse' });
      const index = this.nearestAnchor(e.clientX, e.clientY);
      this.setHovered(index);
      canvas.style.cursor = index !== null ? 'pointer' : 'default';
    });
    // Touch has no hover: a tap shows the point's tooltip.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.setHovered(this.nearestAnchor(e.clientX, e.clientY));
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer.active = false;
      this.setHovered(null);
    });
    new ResizeObserver(() => {
      this.resize();
      if (!this.running) this.renderStill();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pause() : this.play()));
    this.media.reduce.addEventListener('change', () => {
      if (this.media.reduce.matches) {
        this.pause();
        this.renderStill();
      } else this.play();
    });
    this.media.wide.addEventListener('change', () => this.redrawIfIdle());
  }

  private resize(): void {
    const { canvas } = this.options;
    this.width = canvas.clientWidth;
    this.height = canvas.clientHeight;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.gl) {
      Object.assign(this.glCanvas.style, { width: `${this.width}px`, height: `${this.height}px` });
      this.gl.resize(this.width, this.height, this.dpr);
    }
    if (this.scene.text) this.textTargets = this.sampleText(this.scene.text);
    this.computeHomes();
    this.grid = this.drawGrid();
  }

  /** The faint backdrop grid, drawn once per resize. */
  private drawGrid(): HTMLCanvasElement {
    const grid = document.createElement('canvas');
    grid.width = Math.round(this.width * this.dpr);
    grid.height = Math.round(this.height * this.dpr);
    const g = grid.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    g.strokeStyle = this.theme.grid;
    g.lineWidth = 1;
    const cell = this.media.narrow.matches ? 64 : 96;
    g.beginPath();
    for (let gx = (this.width % cell) / 2; gx <= this.width; gx += cell) {
      g.moveTo(Math.round(gx) + 0.5, 0);
      g.lineTo(Math.round(gx) + 0.5, this.height);
    }
    for (let gy = (this.height % cell) / 2; gy <= this.height; gy += cell) {
      g.moveTo(0, Math.round(gy) + 0.5);
      g.lineTo(this.width, Math.round(gy) + 0.5);
    }
    g.stroke();
    return grid;
  }
}
