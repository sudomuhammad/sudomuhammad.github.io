import { describe, expect, it } from 'vitest';
import { candidates, chooseSlot, overlaps, type Box } from './label-layer';

const bounds = { width: 1000, height: 800 };
const centreX = (b: Box) => (b.l + b.r) / 2;

describe('candidates', () => {
  it('offers the four slots beside the point first, then stacked rows with leader lines', () => {
    const options = candidates(500, 400, 100, 12);
    const [right, left, above, below] = options;
    expect(options.slice(0, 4).every((o) => !o.leader)).toBe(true);
    expect(options.slice(4).every((o) => o.leader)).toBe(true);
    expect(right.l).toBeGreaterThan(500);
    expect(left.r).toBeLessThan(500);
    expect(above.b).toBeLessThan(400);
    expect(below.t).toBeGreaterThan(400);
    expect(centreX(above)).toBeCloseTo(500);
  });
});

describe('chooseSlot', () => {
  it('takes the right-hand slot when it is free', () => {
    const options = candidates(500, 400, 100, 12);
    expect(chooseSlot(options, [], bounds, false)).toBe(options[0]);
  });

  it('moves to the next free slot instead of overlapping', () => {
    const options = candidates(500, 400, 100, 12);
    const placed = chooseSlot(options, [options[0]], bounds, false);
    expect(placed).toBe(options[1]);
  });

  it('places a tight cluster of labels without any overlap', () => {
    // Seven skills within ~20px of each other, like one skills group on the map.
    const points = [
      [500, 400], [512, 392], [520, 410], [496, 414], [508, 424], [522, 398], [490, 396],
    ];
    const taken: Box[] = [];
    for (const [x, y] of points) {
      const slot = chooseSlot(candidates(x, y, 110, 11), taken, bounds, true)!;
      expect(taken.some((t) => overlaps(slot, t))).toBe(false);
      taken.push(slot);
    }
  });

  it('two labels on one point never share a slot', () => {
    const a = chooseSlot(candidates(500, 400, 100, 12), [], bounds, true)!;
    const b = chooseSlot(candidates(500, 400, 120, 12), [a], bounds, true)!;
    expect(overlaps(a, b)).toBe(false);
  });

  it('skips a normal label with no free slot, but still draws a forced one', () => {
    const options = candidates(500, 400, 100, 12);
    expect(chooseSlot(options, options, bounds, false)).toBeNull(); // every slot already taken
    expect(chooseSlot(options, options, bounds, true)).toBe(options[0]);
  });

  it('never chooses an off-screen slot when an on-screen one exists', () => {
    const options = candidates(990, 400, 100, 12); // right edge: the right slot is off screen
    expect(chooseSlot(options, [], bounds, false)).toBe(options[1]);
  });
});
