// Wires the page together. Each piece lives in its own module; this file only
// connects them.
import { clusters, labels, mappedPassages } from '../data/map';
import { stackedLayout } from './layout';
import { MapStage } from './map/stage';
import { SearchService } from './search/search-service';
import { StoryController } from './story/controller';
import { AskBar } from './ui/ask-bar';
import { Principles } from './ui/principles';
import { ReadingMeter } from './ui/reading-meter';
import { introWanted, playTokenIntro } from './ui/token-intro';
import { Tooltip } from './ui/tooltip';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const stacked = stackedLayout();
const GAP = 16; // px between the map and the chrome around it
const CARD_SHARE = 0.34; // of the screen width taken by a story card, side by side
const NO_CARD_TOP = 0.58; // stacked, with no card showing (the intro): the map keeps the top 58%

const topbar = $('.topbar');
const askRoot = $('[data-ask]');
const tooltip = new Tooltip($('#tip'));
const meter = new ReadingMeter($('[data-meter]'));

const stage = new MapStage({
  canvas: $<HTMLCanvasElement>('#map'),
  clusters,
  passages: mappedPassages,
  labels,
  // Keep the map clear of the top bar and the ask bar. When stacked, the active card sits
  // under the map, so the map stops above it, however tall the card is.
  insets: () => ({
    top: topbar.offsetHeight + GAP / 2,
    right: GAP,
    bottom: stacked.matches ? innerHeight - activeCardTop() + GAP : askRoot.offsetHeight + GAP,
    left: GAP,
  }),
  onHover: (anchor, x, y) => tooltip.show(anchor, x, y),
  waitForIntro: introWanted(),
});

/** Top edge of the active story card on screen, so the stacked map can stop above it. */
function activeCardTop(): number {
  const top = document.querySelector('.step[data-active] .card')?.getBoundingClientRect().top;
  return top !== undefined && top > 0 && top < innerHeight ? top : innerHeight * NO_CARD_TOP;
}

const story = new StoryController(
  stage,
  // Side by side, cards take the left ~34% of the screen and the camera works in the rest; stacked, it stays centred.
  () => ({ cardShift: stacked.matches ? 0 : CARD_SHARE / 2, stacked: stacked.matches }),
  (step) => {
    document.documentElement.setAttribute('data-step-kind', step.kind);
    meter.show(step);
    principles.reset();
  },
);

const principles = new Principles($('[data-principles]'), (index) => story.emphasise(index));

const search = new SearchService((status) => ask.setStatus(status));
const ask = new AskBar(askRoot, { stage, search, onDismiss: () => story.render() });

$('[data-open-ask]').addEventListener('click', () => ask.open());
story.observe(document.querySelectorAll<HTMLElement>('[data-step]'));
stacked.addEventListener('change', () => story.render());
void playTokenIntro(stage, document.querySelectorAll<HTMLElement>('.token'));
