// What the map shows for each kind of story step. One builder per step kind;
// each returns a complete scene, so nothing lingers from the previous step.
import { person } from '../../data/cv';
import { mappedPassages } from '../../data/map';
import type { Step } from '../../data/story';
import { OVERVIEW, type MapStage, type Scene } from '../map/stage';

export interface SceneContext {
  stage: MapStage;
  /** Sideways camera shift that keeps the subject clear of the step's card. */
  cardShift: number;
  /** Phone held upright: the map sits above the card, so long text is split to fit. */
  stacked: boolean;
  /** Which item in the active card the visitor is pointing at (e.g. a principle), if any. */
  emphasis: number | null;
}

type Builders = { [K in Step['kind']]: (step: Extract<Step, { kind: K }>, ctx: SceneContext) => Scene };

const passagesIn = (clusterId: number) => mappedPassages.filter((p) => p.cluster === clusterId).map((p) => p.id);
// The whole map beside a card. `cardShift` is half the card's share of the width, so the map is
// centred in what's left (shift) and scaled to fit it (1 - card share).
const shifted = (ctx: SceneContext) => ({ ...OVERVIEW.camera, zoom: 1 - 2 * ctx.cardShift, shift: ctx.cardShift });

const builders: Builders = {
  // The name leads; the map is a quiet, unlabelled backdrop until the visitor scrolls.
  intro: () => ({ ...OVERVIEW, labels: { kind: 'none' }, fade: 0.35 }),

  // The whole map with every principle's evidence lit; pointing at one narrows it to that one.
  approach: ({ principles }, ctx) => {
    const shown = ctx.emphasis === null ? principles : [principles[ctx.emphasis]];
    return {
      ...OVERVIEW,
      camera: shifted(ctx),
      lit: [...new Set(shown.flatMap((p) => p.evidence.map((e) => e.id)))],
      labels: { kind: 'none' }, // lit passages are always named
    };
  },

  chapter: (_, ctx) => ({ ...OVERVIEW, camera: shifted(ctx) }),

  cluster: ({ cluster, evidence }, ctx) => ({
    ...OVERVIEW,
    camera: ctx.stage.frame({ passages: passagesIn(cluster.id) }, ctx.cardShift),
    focus: [cluster.id],
    lit: evidence.map((p) => p.id),
    labels: { kind: 'focus' },
  }),

  // Zoom to the group's skills so their names have room.
  skills: ({ terms }, ctx) => ({
    ...OVERVIEW,
    camera: ctx.stage.frame({ terms }, ctx.cardShift),
    litTerms: terms,
    labels: { kind: 'terms', terms },
  }),

  // Stacked, the address is split after the @ so it can be set large enough to read.
  contact: (_, ctx) => ({
    ...OVERVIEW,
    text: ctx.stacked ? person.email.replace('@', '@\n').split('\n') : [person.email],
  }),
};

export function sceneFor(step: Step, ctx: SceneContext): Scene {
  const build = builders[step.kind] as (step: Step, ctx: SceneContext) => Scene;
  return build(step, ctx);
}

