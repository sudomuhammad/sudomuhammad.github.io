// Turns lines of text into points, so particles can re-form into words.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Options {
  /** CSS font family; the weight and size are chosen here. */
  family: string;
  /** Largest share of the rect the text may cover. */
  maxWidth?: number;
  maxHeight?: number;
  /** Roughly how many points across one character's height; higher is denser. */
  density?: number;
  /** Most points to return (e.g. the particles available); sampling coarsens to fit. */
  maxPoints?: number;
}

export interface TextSample {
  /** Flat [x0, y0, x1, y1, …] coordinates of the text's opaque pixels, in page space. */
  points: Float32Array;
  /** Distance between neighbouring sample points, in px; small text samples more finely. */
  spacing: number;
}

/** Lay `lines` out centred in `rect`, as large as fits, and sample its opaque pixels. */
export function sampleText(lines: string[], rect: Rect, options: Options): TextSample {
  const { family, maxWidth = 0.86, maxHeight = 0.6, density = 26, maxPoints = Infinity } = options;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const g = canvas.getContext('2d', { willReadFrequently: true })!;

  let size = 160;
  const widest = () => {
    g.font = `700 ${size}px ${family}`;
    return Math.max(...lines.map((line) => g.measureText(line).width));
  };
  while (size > 18 && (widest() > rect.width * maxWidth || size * 1.1 * lines.length > rect.height * maxHeight)) {
    size -= 4;
  }

  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lineHeight = size * 1.1;
  lines.forEach((line, i) => {
    g.fillText(line, rect.width / 2, rect.height / 2 + (i - (lines.length - 1) / 2) * lineHeight);
  });

  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  const sample = (step: number) => {
    const points: number[] = [];
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        // Floor, not round: rounding the last column up would read the next row's first pixel.
        const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4 + 3;
        if (data[i] > 128) points.push(rect.left + x, rect.top + y);
      }
    }
    return points;
  };

  // Points scale with 1/step², so if there are too many, widen the step by the square root
  // of the excess and sample again; a couple of passes always lands under the limit.
  let step = Math.max(1, size / density);
  let points = sample(step);
  while (points.length / 2 > maxPoints) {
    step *= Math.sqrt(points.length / 2 / maxPoints) * 1.02;
    points = sample(step);
  }
  return { points: Float32Array.from(points), spacing: step };
}
