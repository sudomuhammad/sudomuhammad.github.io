import type { Cluster, ClusterId } from '../data/cv';

interface Options {
  canvas: HTMLCanvasElement;
  clusters: Cluster[];
  onSelect: (id: ClusterId | null) => void;
}

export interface EmbeddingMap {
  select: (id: ClusterId | null) => void;
  highlight: (terms: Set<string>) => void;
}

// Neutral colours come from the CSS custom properties in global.css so the theme lives in one place.
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SANS = "'Bricolage Grotesque Variable', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono Variable', ui-monospace, Menlo, monospace";

// Share of particles per cluster; the remainder is unclustered "noise" spread across the map.
const WEIGHTS: Record<ClusterId, number> = { agents: 0.34, retrieval: 0.17, data: 0.23, shipping: 0.18 };

/** Deterministic PRNG so the map looks the same on every visit. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function createEmbeddingMap({ canvas, clusters, onSelect }: Options): EmbeddingMap {
  const ctx = canvas.getContext('2d')!;
  const NOISE_COLOR = css('--noise');
  const INK = css('--ink');
  const INK_3 = css('--ink-3');
  const GRID = css('--grid');
  const GROUND = css('--ground');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = window.matchMedia('(max-width: 959px)');

  const rand = mulberry32(1994);
  const count = narrow.matches ? 1400 : 3000;
  const clusterIndex = new Map(clusters.map((c, i) => [c.id, i]));

  // Particle state, in map units (0–1) for homes and CSS pixels for live positions.
  const baseX = new Float32Array(count);
  const baseY = new Float32Array(count);
  const homeX = new Float32Array(count);
  const homeY = new Float32Array(count);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const group = new Int8Array(count); // cluster index, -1 = noise

  // Labelled points: one per term, placed on a golden-angle spiral around the cluster centre.
  interface Label { term: string; cluster: number; index: number }
  const labels: Label[] = [];
  const subCentres: [number, number][][] = clusters.map((c) =>
    c.terms.map((_, t) => {
      const angle = t * 2.39996;
      const r = 0.028 + 0.017 * Math.sqrt(t + 1);
      return [c.centre[0] + Math.cos(angle) * r * 1.25, c.centre[1] + Math.sin(angle) * r * 1.6];
    }),
  );

  let i = 0;
  clusters.forEach((c, ci) => {
    c.terms.forEach((term, t) => {
      baseX[i] = subCentres[ci][t][0];
      baseY[i] = subCentres[ci][t][1];
      group[i] = ci;
      labels.push({ term, cluster: ci, index: i });
      i++;
    });
  });
  for (const c of clusters) {
    const ci = clusterIndex.get(c.id)!;
    const n = Math.round(count * WEIGHTS[c.id]);
    for (let k = 0; k < n && i < count; k++, i++) {
      const sc = subCentres[ci][Math.floor(rand() * subCentres[ci].length)];
      const tight = rand() < 0.7;
      const s = tight ? 0.016 : 0.05;
      baseX[i] = (tight ? sc[0] : c.centre[0]) + gauss(rand) * s;
      baseY[i] = (tight ? sc[1] : c.centre[1]) + gauss(rand) * s * 1.3;
      group[i] = ci;
    }
  }
  for (; i < count; i++) {
    baseX[i] = 0.38 + rand() * 0.62;
    baseY[i] = rand();
    group[i] = -1;
  }

  let width = 0;
  let height = 0;
  let dpr = 1;
  let selected: number | null = null;
  let highlighted = new Set<string>();
  const alpha = new Float32Array(clusters.length + 1).fill(1); // last slot = noise
  const pointer = { x: -9999, y: -9999, active: false };
  let hoverLabel: Label | null = null;
  let grid: HTMLCanvasElement | null = null;
  let start = performance.now();
  let running = false;
  let visible = true;

  // Map units → pixels. On narrow screens the intro column stacks above, so the map spreads full width.
  const mapX = (u: number) => (narrow.matches ? (u - 0.3) / 0.72 : u) * width;
  const mapY = (v: number) => (0.06 + v * 0.88) * height;

  function computeHomes() {
    const fx = 0.7;
    const fy = 0.5;
    for (let p = 0; p < count; p++) {
      let hx = baseX[p];
      let hy = baseY[p];
      if (selected !== null) {
        if (group[p] === selected) {
          const c = clusters[selected].centre;
          hx = fx + (hx - c[0]) * 1.55;
          hy = fy + (hy - c[1]) * 1.55;
        } else {
          hx += (hx - fx) * 0.45;
          hy += (hy - fy) * 0.45;
        }
      }
      homeX[p] = mapX(hx);
      homeY[p] = mapY(hy);
    }
  }

  function drawGrid() {
    grid = document.createElement('canvas');
    grid.width = width * dpr;
    grid.height = height * dpr;
    const g = grid.getContext('2d')!;
    g.scale(dpr, dpr);
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.font = `11px ${MONO}`;
    g.fillStyle = INK_3;
    const ticks = 8;
    const left = narrow.matches ? 0 : width * 0.37;
    for (let t = 0; t <= ticks; t++) {
      const gx = left + ((width - left) * t) / ticks;
      const gy = (height * t) / ticks;
      g.beginPath();
      g.moveTo(Math.round(gx) + 0.5, 0);
      g.lineTo(Math.round(gx) + 0.5, height);
      g.moveTo(left, Math.round(gy) + 0.5);
      g.lineTo(width, Math.round(gy) + 0.5);
      g.stroke();
      if (t > 0 && t < ticks) {
        const value = (-2 + (4 * t) / ticks).toFixed(1);
        g.fillText(value, gx + 4, height - 8);
        g.fillText(value, width - 30, gy - 5);
      }
    }
    g.fillStyle = INK_3;
    g.fillText('dim 1', width - 44, height - 24);
    g.save();
    g.translate(width - 12, 56);
    g.rotate(Math.PI / 2);
    g.fillText('dim 2', 0, 0);
    g.restore();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeHomes();
    drawGrid();
  }

  function scatter() {
    for (let p = 0; p < count; p++) {
      x[p] = width * (narrow.matches ? 0 : 0.38) + rand() * width * (narrow.matches ? 1 : 0.62);
      y[p] = rand() * height;
      vx[p] = 0;
      vy[p] = 0;
    }
  }

  function settle() {
    for (let p = 0; p < count; p++) {
      x[p] = homeX[p];
      y[p] = homeY[p];
      vx[p] = 0;
      vy[p] = 0;
    }
  }

  function step(now: number) {
    // The opening "training" moment: springs stiffen over ~1.8s so noise settles into clusters.
    const t = Math.min(1, (now - start) / 1800);
    const k = 0.0025 + 0.0115 * (1 - Math.pow(1 - t, 3));
    const jitter = 0.12;
    const R = narrow.matches ? 60 : 96;
    const R2 = R * R;
    for (let p = 0; p < count; p++) {
      let ax = (homeX[p] - x[p]) * k;
      let ay = (homeY[p] - y[p]) * k;
      if (pointer.active) {
        const dx = x[p] - pointer.x;
        const dy = y[p] - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d / R) ** 2 * 2.4;
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
      ax += (Math.random() - 0.5) * jitter;
      ay += (Math.random() - 0.5) * jitter;
      vx[p] = (vx[p] + ax) * 0.86;
      vy[p] = (vy[p] + ay) * 0.86;
      x[p] += vx[p];
      y[p] += vy[p];
    }
    for (let c = 0; c <= clusters.length; c++) {
      const target = selected === null ? 1 : c === selected ? 1 : 0.16;
      alpha[c] += (target - alpha[c]) * 0.12;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (grid) ctx.drawImage(grid, 0, 0, width, height);

    // Points, batched by colour.
    const size = narrow.matches ? 1.8 : 2;
    for (let c = -1; c < clusters.length; c++) {
      ctx.globalAlpha = c === -1 ? alpha[clusters.length] * 0.8 : alpha[c] * 0.88;
      ctx.fillStyle = c === -1 ? NOISE_COLOR : clusters[c].color;
      ctx.beginPath();
      for (let p = 0; p < count; p++) {
        if (group[p] !== c) continue;
        ctx.rect(x[p] - size / 2, y[p] - size / 2, size, size);
      }
      ctx.fill();
    }

    // Labelled points.
    ctx.font = `500 ${narrow.matches ? 11 : 12.5}px ${SANS}`;
    ctx.textBaseline = 'middle';
    for (const l of labels) {
      const lx = x[l.index];
      const ly = y[l.index];
      const isHover = hoverLabel === l;
      const isMatch = highlighted.has(l.term);
      const a = Math.max(alpha[l.cluster], isMatch ? 1 : 0);
      ctx.globalAlpha = a;
      ctx.fillStyle = clusters[l.cluster].color;
      ctx.beginPath();
      ctx.arc(lx, ly, isHover || isMatch ? 5 : 3.4, 0, Math.PI * 2);
      ctx.fill();
      if (isHover || isMatch) {
        ctx.strokeStyle = clusters[l.cluster].color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(lx, ly, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      // On small screens only the selected cluster's labels are named, to avoid a pile-up.
      if (narrow.matches && selected !== l.cluster && !isHover && !isMatch) continue;
      ctx.globalAlpha = Math.min(1, a * (selected === null || selected === l.cluster ? 1 : 0.6));
      ctx.font = `${isHover || isMatch ? 650 : 500} ${narrow.matches ? 11 : 12.5}px ${SANS}`;
      // Flip the label to the left of its point near the right edge so it never clips.
      const tw = ctx.measureText(l.term).width;
      const tx = lx + 8 + tw > width - 40 ? lx - 8 - tw : lx + 8;
      // A ground-coloured halo keeps labels readable where they cross other points.
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = GROUND;
      ctx.strokeText(l.term, tx, ly);
      ctx.fillStyle = INK;
      ctx.globalAlpha *= isHover || isMatch ? 1 : 0.82;
      ctx.fillText(l.term, tx, ly);
    }
    ctx.globalAlpha = 1;
  }

  function frame(now: number) {
    if (!running) return;
    step(now);
    draw();
    requestAnimationFrame(frame);
  }

  function play() {
    if (running || reduceMotion.matches || !visible || document.hidden) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
  }

  function renderStill() {
    computeHomes();
    settle();
    for (let c = 0; c <= clusters.length; c++) alpha[c] = selected === null || c === selected ? 1 : 0.16;
    draw();
  }

  function nearestLabel(px: number, py: number): Label | null {
    let best: Label | null = null;
    let bestD = 26 * 26;
    for (const l of labels) {
      const dx = x[l.index] - px;
      const dy = y[l.index] - py;
      const d = dx * dx + dy * dy;
      if (d < bestD && (selected === null || l.cluster === selected)) {
        bestD = d;
        best = l;
      }
    }
    return best;
  }

  function nearestCluster(px: number, py: number): number | null {
    let best: number | null = null;
    let bestD = 150 * 150;
    clusters.forEach((_, ci) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const l of labels) {
        if (l.cluster !== ci) continue;
        sx += x[l.index];
        sy += y[l.index];
        n++;
      }
      const dx = sx / n - px;
      const dy = sy / n - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = ci;
      }
    });
    return best;
  }

  function localPoint(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  canvas.addEventListener('pointermove', (e) => {
    const { px, py } = localPoint(e);
    pointer.x = px;
    pointer.y = py;
    pointer.active = e.pointerType === 'mouse';
    hoverLabel = nearestLabel(px, py);
    canvas.style.cursor = hoverLabel || nearestCluster(px, py) !== null ? 'pointer' : 'default';
    if (!running) draw();
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.active = false;
    hoverLabel = null;
    if (!running) draw();
  });
  canvas.addEventListener('click', (e) => {
    const { px, py } = localPoint(e as PointerEvent);
    const label = nearestLabel(px, py);
    const target = label ? label.cluster : nearestCluster(px, py);
    const next = target === null || target === selected ? null : target;
    onSelect(next === null ? null : clusters[next].id);
  });

  new ResizeObserver(() => {
    resize();
    if (!running) renderStill();
  }).observe(canvas);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? play() : pause();
  }).observe(canvas);

  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) {
      pause();
      renderStill();
    } else play();
  });

  resize();
  if (reduceMotion.matches) {
    renderStill();
  } else {
    scatter();
    start = performance.now();
    play();
  }

  return {
    select(id) {
      selected = id === null ? null : clusterIndex.get(id) ?? null;
      computeHomes();
      if (reduceMotion.matches) renderStill();
    },
    highlight(terms) {
      highlighted = terms;
      if (!running) draw();
    },
  };
}
