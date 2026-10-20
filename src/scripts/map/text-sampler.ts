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
}

/**
 * Lay `lines` out centred in `rect`, as large as fits, and return the opaque
 * pixels as flat [x0, y0, x1, y1, …] coordinates in the rect's space.
 */
export function sampleText(lines: string[], rect: Rect, options: Options): Float32Array {
  const { family, maxWidth = 0.86, maxHeight = 0.6, density = 26 } = options;
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
  const step = Math.max(2, Math.round(size / density));
  const points: number[] = [];
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if (data[(y * canvas.width + x) * 4 + 3] > 128) points.push(rect.left + x, rect.top + y);
    }
  }
  return Float32Array.from(points);
}
