// Collision-free placement of point labels on a 2D canvas, cartography style.
// Each label first tries the four slots beside its point (right, left, above,
// below). In dense spots it moves outward into stacked rows on either side and
// is drawn with a thin leader line back to its point.

export interface LabelItem {
  x: number;
  y: number;
  text: string;
  /** Lower is more important; placed first, so it gets the best slot. */
  rank: number;
  /** Must be drawn (hovered or highlighted): takes the best on-screen slot even if all overlap. */
  force: boolean;
  size: number;
  weight: number;
  alpha: number;
}

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** A candidate position; `leader` slots sit away from the point and get a line back to it. */
export interface Slot extends Box {
  leader: boolean;
}

export interface Bounds {
  width: number;
  height: number;
}

interface Style {
  family: string;
  ink: string;
  /** Halo colour drawn behind text so it reads over points. */
  halo: string;
}

const GAP = 9; // between a point and its label
const PAD = 3; // clearance kept around each label
const RINGS = 5; // how many stacked rows to try on each side before giving up

export const overlaps = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const onScreen = (box: Box, { width, height }: Bounds) => box.l >= 0 && box.t >= 0 && box.r <= width && box.b <= height;

/** Candidate slots in order of preference: the four beside the point, then stacked rows moving outward. */
export function candidates(x: number, y: number, width: number, size: number): Slot[] {
  const half = size / 2 + PAD;
  const row = size + 2 * PAD + 2;
  const slot = (left: number, centreY: number, leader: boolean): Slot => ({
    l: left - PAD,
    t: centreY - half,
    r: left + width + PAD,
    b: centreY + half,
    leader,
  });
  const right = x + GAP;
  const left = x - GAP - width;
  const beside = [
    slot(right, y, false),
    slot(left, y, false),
    slot(x - width / 2, y - row, false),
    slot(x - width / 2, y + row, false),
  ];
  const stacked = Array.from({ length: RINGS }, (_, i) => (i + 1) * row).flatMap((dy) => [
    slot(right + GAP, y - dy, true),
    slot(right + GAP, y + dy, true),
    slot(left - GAP, y - dy, true),
    slot(left - GAP, y + dy, true),
  ]);
  return [...beside, ...stacked];
}

/**
 * The first candidate that's on screen and clear of `taken`. If none is clear,
 * a forced label still gets its first on-screen candidate; others get null.
 */
export function chooseSlot<T extends Box>(options: T[], taken: Box[], bounds: Bounds, force: boolean): T | null {
  const visible = options.filter((box) => onScreen(box, bounds));
  return visible.find((box) => !taken.some((other) => overlaps(box, other))) ?? (force ? (visible[0] ?? options[0]) : null);
}

export class LabelLayer {
  private readonly widths = new Map<string, number>();

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(items: LabelItem[], style: Style, bounds: Bounds): void {
    const { ctx } = this;
    const taken: Box[] = [];
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Forced labels first, then by rank, so what matters most gets the best slots.
    const ordered = [...items].sort((a, b) => Number(b.force) - Number(a.force) || a.rank - b.rank);
    for (const item of ordered) {
      ctx.font = `${item.weight} ${item.size}px ${style.family}`;
      const slot = chooseSlot(candidates(item.x, item.y, this.measure(item), item.size), taken, bounds, item.force);
      if (!slot) continue;
      taken.push(slot);
      ctx.globalAlpha = item.alpha;
      if (slot.leader) this.leader(item, slot, style.ink);
      const ty = (slot.t + slot.b) / 2;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = style.halo;
      ctx.strokeText(item.text, slot.l + PAD, ty);
      ctx.fillStyle = style.ink;
      ctx.fillText(item.text, slot.l + PAD, ty);
    }
    ctx.globalAlpha = 1;
  }

  /** A thin line from the point to the near edge of its label. */
  private leader(item: LabelItem, slot: Slot, color: string): void {
    const { ctx } = this;
    const toRight = slot.l > item.x;
    ctx.save();
    ctx.globalAlpha *= 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(item.x, item.y);
    ctx.lineTo(toRight ? slot.l : slot.r, (slot.t + slot.b) / 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Text widths are cached; measuring is the slow part of drawing labels every frame. */
  private measure(item: LabelItem): number {
    const key = `${item.weight}|${item.size}|${item.text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      width = this.ctx.measureText(item.text).width;
      this.widths.set(key, width);
    }
    return width;
  }
}
