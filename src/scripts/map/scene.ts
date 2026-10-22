// What the map shows (a scene) and where it looks (a camera). Pure data and geometry,
// so story code can describe scenes without touching the renderer.
import type { Label, MappedPassage } from '../../data/map';

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
  | { kind: 'focus' } // the focused themes' titles and skills
  | { kind: 'terms'; terms: string[] } // just these skills
  | { kind: 'none' };

export interface Scene {
  camera: Camera;
  /** Theme ids to light; others dim. null lights everything. */
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

/** Screen space, in css pixels, kept clear of the map (top bar, ask bar, the active card). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SPAN = 0.08; // map units: never zoom in so far that one point fills the screen
const MAX_ZOOM = 2.6;
const FILL = 0.55; // share of the viewport a framed group spans

/** A camera that frames these points (map units), `shift` leaving room for a card. */
export function frameCamera(points: { x: number; y: number }[], shift = 0): Camera {
  if (!points.length) return { ...OVERVIEW.camera, shift };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const span = Math.max(MIN_SPAN, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return {
    cx: (Math.max(...xs) + Math.min(...xs)) / 2,
    cy: (Math.max(...ys) + Math.min(...ys)) / 2,
    zoom: Math.min(MAX_ZOOM, FILL / span),
    shift,
  };
}

/**
 * Map units -> screen pixels. UMAP normalises its axes separately, so each fits its own
 * side of the viewport; `screenWidth` scales the camera's sideways shift.
 */
export function project(u: number, v: number, camera: Camera, vp: Viewport, screenWidth: number): [number, number] {
  const { cx, cy, zoom, shift } = camera;
  return [
    vp.left + vp.width / 2 + shift * screenWidth + (u - cx) * vp.width * 0.92 * zoom,
    vp.top + vp.height / 2 + (v - cy) * vp.height * 0.88 * zoom,
  ];
}
