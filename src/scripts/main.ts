// Wires the page together. Each piece lives in its own module; this file only
// connects them.
import { clusters, labels, mappedPassages } from '../data/map';
import { MapStage } from './map/stage';
import { SearchService } from './search/search-service';
import { StoryController } from './story/controller';
import { AskBar } from './ui/ask-bar';
import { ReadingMeter } from './ui/reading-meter';
import { introWanted, playTokenIntro } from './ui/token-intro';
import { Tooltip } from './ui/tooltip';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const phone = matchMedia('(max-width: 959px)');
const PHONE_CARD_SHARE = 0.42; // of the screen height, kept for story cards on phones
const GAP = 16; // px between the map and the chrome around it
const CARD_SHARE = 0.34; // of the screen width taken by a story card on desktop

const topbar = $('.topbar');
const askRoot = $('[data-ask]');
const tooltip = new Tooltip($('#tip'));
const meter = new ReadingMeter($('[data-meter]'));

const stage = new MapStage({
  canvas: $<HTMLCanvasElement>('#map'),
  clusters,
  passages: mappedPassages,
  labels,
  // Keep the map clear of the top bar and the ask bar; on phones story cards also take the lower part of the screen.
  insets: () => ({
    top: topbar.offsetHeight + GAP / 2,
    right: GAP,
    bottom: phone.matches ? innerHeight * PHONE_CARD_SHARE : askRoot.offsetHeight + GAP,
    left: GAP,
  }),
  onHover: (anchor, x, y) => tooltip.show(anchor, x, y),
  waitForIntro: introWanted(),
});

const story = new StoryController(
  stage,
  // Desktop cards take the left ~34% of the screen, so the camera works in the rest; phones keep it centred.
  () => ({ cardShift: phone.matches ? 0 : CARD_SHARE / 2, phone: phone.matches }),
  (step) => {
    document.documentElement.setAttribute('data-step-kind', step.kind);
    meter.show(step);
  },
);

const search = new SearchService((status) => ask.setStatus(status));
const ask = new AskBar(askRoot, { stage, search, onDismiss: () => story.render() });

$('[data-open-ask]').addEventListener('click', () => ask.open());
story.observe(document.querySelectorAll<HTMLElement>('[data-step]'));
phone.addEventListener('change', () => story.render());
void playTokenIntro(stage, document.querySelectorAll<HTMLElement>('.token'));
