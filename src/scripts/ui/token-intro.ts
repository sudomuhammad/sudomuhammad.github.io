// The opening moment: the name and tagline show as their WordPiece tokens, then
// burst into the map's particles. The <html class="intro"> flag is set in <head>
// before first paint (see Base.astro) so the headline never flashes.
import type { MapStage } from '../map/stage';

const HOLD_MS = 1100; // how long the tokens stay on screen
const FONT_TIMEOUT_MS = 1500; // don't hold the intro hostage to slow fonts

export const introWanted = () => document.documentElement.classList.contains('intro');

export async function playTokenIntro(stage: MapStage, tokens: Iterable<HTMLElement>): Promise<void> {
  const root = document.documentElement;
  if (!introWanted()) return;
  root.classList.add('intro-js'); // the script now owns the timing; the CSS fallback stands down
  const shown = performance.now();
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, FONT_TIMEOUT_MS))]);
  await new Promise((r) => setTimeout(r, Math.max(0, HOLD_MS - (performance.now() - shown))));
  const origins = [...tokens].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  stage.burstFrom(origins);
  root.classList.add('intro-done');
}
