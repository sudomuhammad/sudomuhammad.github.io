// The full-screen map that stays on stage for the whole story. Chapters drive it with
// declarative scenes (see scene.ts). A scene change only moves each particle's home; the
// physics turns it into motion. This class owns the loop, drawing and input; the camera
// maths, the question particle and the grid live in their own modules.
import type { Label, MappedPassage, Theme } from '../../data/map';
import { createGlCloud, type GlCloud } from './gl-cloud';
import { drawGrid } from './grid';
import { LabelLayer, type LabelItem } from './label-layer';
import { ParticleSystem, type Pointer } from './particles';
import { QueryParticle } from './query';
import { seededRandom, shufflePairs } from './random';
import { frameCamera, OVERVIEW, project, type Anchor, type Camera, type Insets, type Scene, type Viewport } from './scene';
import { sampleText } from './text-sampler';

interface Options {
  canvas: HTMLCanvasElement;
  themes: Theme[];
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
  private readonly query: QueryParticle;
  /** When the particles last started forming a new shape; see FORMATION. */
  private formStarted = performance.now();
  private revealed: boolean;
  private running = false;

  constructor(private readonly options: Options) {
    const { canvas, themes, passages, labels } = options;
    this.ctx = canvas.getContext('2d')!;
    this.labelLayer = new LabelLayer(this.ctx);
    this.colors = [...themes.map((t) => t.color), css('--noise')];
    this.slotOf = new Map(themes.map((t, i) => [t.id, i]));
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
        ...passages.map((p) => ({ x: p.x, y: p.y, slot: this.slotOf.get(p.theme)! })),
        ...labels.map((l) => ({ x: l.x, y: l.y, slot: this.slotOf.get(l.theme)! })),
      ],
      {
        cloudSources: passages.length,
        cloudPerAnchor: Math.max(8, Math.floor((budget * (1 - NOISE_SHARE)) / passages.length)),
        spread: CLOUD_SPREAD,
        noise: Math.round(budget * NOISE_SHARE),
        noiseSlot: themes.length,
      },
      this.random,
    );
    this.query = new QueryParticle(this.particles);

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
    return frameCamera(points, shift);
  }

  /** Show a question as a particle that launches from `from` and settles among its matches. */
  ask(passageIds: number[] | null, from?: { x: number; y: number }): void {
    const targets = (passageIds ?? []).map((id) => this.anchorOf.get(id)).filter((a) => a !== undefined);
    this.query.show(targets, from, this.media.reduce.matches);
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

  private viewport(): Viewport {
    const i: Insets = this.options.insets();
    return { left: i.left, top: i.top, width: this.width - i.left - i.right, height: this.height - i.top - i.bottom };
  }

  private computeHomes(): void {
    const p = this.particles;
    const targets = this.textTargets;
    const vp = this.viewport();
    for (let i = 0; i < p.count; i++) {
      if (targets && i >= p.anchorCount) {
        const t = ((i - p.anchorCount) % (targets.length / 2)) * 2;
        p.homeX[i] = targets[t];
        p.homeY[i] = targets[t + 1];
      } else {
        [p.homeX[i], p.homeY[i]] = project(p.baseX[i], p.baseY[i], this.scene.camera, vp, this.width);
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
    this.query.step();
  }

  /** Spring stiffness for this frame, following the FORMATION curve since the last new shape. */
  private stiffness(now: number): number {
    const t = Math.min(1, (now - this.formStarted) / FORMATION.ms);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // ease-in-out cubic
    return FORMATION.start + (FORMATION.end - FORMATION.start) * eased;
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
    this.query.draw(this.ctx, { colors: this.colors, ...this.theme }, this.media.reduce.matches);
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

  private ring(x: number, y: number, radius: number, color: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
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
    this.grid = drawGrid(this.width, this.height, this.dpr, this.theme.grid, this.media.narrow.matches ? 64 : 96);
  }
}
