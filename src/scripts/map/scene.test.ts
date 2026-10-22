import { describe, expect, it } from 'vitest';
import { frameCamera, OVERVIEW, project } from './scene';

describe('frameCamera', () => {
  it('centres on the points and zooms so their wider side spans 55% of the view', () => {
    const camera = frameCamera([{ x: 0.2, y: 0.4 }, { x: 0.7, y: 0.5 }], 0.17);
    expect(camera.cx).toBeCloseTo(0.45);
    expect(camera.cy).toBeCloseTo(0.45);
    expect(camera.zoom).toBeCloseTo(0.55 / 0.5);
    expect(camera.shift).toBe(0.17);
  });

  it('never zooms in past the cap, even on a single point', () => {
    expect(frameCamera([{ x: 0.5, y: 0.5 }]).zoom).toBe(2.6);
  });

  it('falls back to the whole map, keeping the shift, when there is nothing to frame', () => {
    expect(frameCamera([], 0.1)).toEqual({ ...OVERVIEW.camera, shift: 0.1 });
  });
});

describe('project', () => {
  const vp = { left: 100, top: 50, width: 800, height: 600 };

  it('puts the camera centre in the middle of the viewport', () => {
    expect(project(0.5, 0.5, OVERVIEW.camera, vp, 1000)).toEqual([500, 350]);
  });

  it('moves everything sideways by the shift, as a share of the screen', () => {
    const [x] = project(0.5, 0.5, { ...OVERVIEW.camera, shift: 0.1 }, vp, 1000);
    expect(x).toBe(600);
  });
});
