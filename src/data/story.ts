// The scroll story, derived once from the CV and the map. Astro renders the
// cards from it and the browser builds each step's scene from it, so the two
// can't drift apart.
import { skills } from './cv';
import { clusters, labels, mappedPassages, type Cluster, type MappedPassage } from './map';

export type Step =
  | { kind: 'intro'; id: string }
  | { kind: 'chapter'; id: string; chapter: ChapterId }
  | { kind: 'cluster'; id: string; cluster: Cluster; evidence: MappedPassage[]; skills: string[] }
  | { kind: 'skills'; id: string; group: string; items: string[]; terms: string[] }
  | { kind: 'contact'; id: string };

export type ChapterId = 'work' | 'skills' | 'contact';

export interface Chapter {
  id: ChapterId;
  /** Short name for the menu. */
  nav: string;
  title: string;
  lede: string;
  steps: Step[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ------------------------------------------------------------------ work: one step per cluster
const EVIDENCE_PER_CLUSTER = 3;

const clusterSteps: Step[] = clusters.map((cluster) => ({
  kind: 'cluster',
  id: `work-${cluster.key}`,
  cluster,
  evidence: mappedPassages
    .filter((p) => p.cluster === cluster.id && (p.kind === 'point' || p.kind === 'education'))
    .slice(0, EVIDENCE_PER_CLUSTER),
  skills: labels.filter((l) => l.cluster === cluster.id).map((l) => l.term),
}));

// ------------------------------------------------------------------ skills: one step per group
const skillSteps: Step[] = skills.map((s) => ({
  kind: 'skills',
  id: `skills-${slug(s.group)}`,
  group: s.group,
  items: s.items,
  // Only items that exist as labels on the map can light up.
  terms: labels.filter((l) => s.items.some((i) => i.toLowerCase() === l.term.toLowerCase())).map((l) => l.term),
}));

// ------------------------------------------------------------------ chapters
export const chapters: Chapter[] = [
  {
    id: 'work',
    nav: 'Work',
    title: 'What I work on',
    lede: 'Six areas the map found in my CV. Each stop pulls its points together.',
    steps: [{ kind: 'chapter', id: 'work', chapter: 'work' }, ...clusterSteps],
  },
  {
    id: 'skills',
    nav: 'Skills',
    title: 'Tools and techniques',
    lede: 'Where each skill sits on the map, group by group.',
    steps: [{ kind: 'chapter', id: 'skills', chapter: 'skills' }, ...skillSteps],
  },
  {
    id: 'contact',
    nav: 'Contact',
    title: 'Let’s talk',
    lede: 'Hiring for an AI engineer? Email is quickest.',
    steps: [{ kind: 'contact', id: 'contact' }],
  },
];

export const introStep: Step = { kind: 'intro', id: 'top' };

const orderedSteps: Step[] = [introStep, ...chapters.flatMap((c) => c.steps)];

/** Every step, in scroll order, by id. */
export const stepsById = new Map<string, Step>(orderedSteps.map((step) => [step.id, step]));

// ------------------------------------------------------------------ reading progress
// A scroll story has no visible page length, so the page shows how far through it the
// reader is, counted as the CV tokens (MiniLM WordPiece) its cards have shown so far.

const sum = (ids: number[]) => mappedPassages.filter((p) => ids.includes(p.id)).reduce((n, p) => n + p.tokens, 0);
const skillsPassage = (group: string) => mappedPassages.filter((p) => p.source === `Skills: ${group}`).map((p) => p.id);

const TOKENS_SHOWN: { [K in Step['kind']]: (step: Extract<Step, { kind: K }>) => number } = {
  intro: () => 0,
  chapter: () => 0,
  cluster: (step) => sum(step.evidence.map((p) => p.id)),
  skills: (step) => sum(skillsPassage(step.group)),
  contact: () => 0,
};

const tokensShown = (step: Step) => (TOKENS_SHOWN[step.kind] as (s: Step) => number)(step);

export interface Progress {
  /** Tokens shown by this step and every step before it. */
  read: number;
  /** The chapter the step belongs to, for the label; null for the intro. */
  chapter: string | null;
}

export const READING_TOTAL = orderedSteps.reduce((n, step) => n + tokensShown(step), 0);

export const progressById: Map<string, Progress> = (() => {
  const chapterOf = new Map(chapters.flatMap((c) => c.steps.map((s) => [s.id, c.nav] as const)));
  let read = 0;
  return new Map(
    orderedSteps.map((step) => {
      read += tokensShown(step);
      return [step.id, { read, chapter: chapterOf.get(step.id) ?? null }];
    }),
  );
})();
