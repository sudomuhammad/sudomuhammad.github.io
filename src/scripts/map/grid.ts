// The faint backdrop grid, drawn once per resize onto its own canvas and copied each frame.

export function drawGrid(width: number, height: number, dpr: number, color: string, cell: number): HTMLCanvasElement {
  const grid = document.createElement('canvas');
  grid.width = Math.round(width * dpr);
  grid.height = Math.round(height * dpr);
  const g = grid.getContext('2d')!;
  g.scale(dpr, dpr);
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  // Centred, so the margins left over at each edge match.
  for (let gx = (width % cell) / 2; gx <= width; gx += cell) {
    g.moveTo(Math.round(gx) + 0.5, 0);
    g.lineTo(Math.round(gx) + 0.5, height);
  }
  for (let gy = (height % cell) / 2; gy <= height; gy += cell) {
    g.moveTo(0, Math.round(gy) + 0.5);
    g.lineTo(width, Math.round(gy) + 0.5);
  }
  g.stroke();
  return grid;
}
