// The scroll story, derived once from the CV and the map. Astro renders the
// cards from it and the browser builds each step's scene from it, so the two
// can't drift apart.
import { approach } from './approach';
import { skills } from './cv';
import { clusters, labels, mappedPassages, type Cluster, type MappedPassage } from './map';
import { TECHNIQUES_KEY, techniques, toolsByArea, workOrder } from './work';

/** A "How I work" principle with its evidence resolved to map passages. */
export interface Principle {
  title: string;
  text: string;
  evidence: MappedPassage[];
}

export type Step =
  | { kind: 'intro'; id: string }
  | { kind: 'approach'; id: string; principles: Principle[] }
  | { kind: 'chapter'; id: string; chapter: ChapterId }
  | { kind: 'cluster'; id: string; cluster: Cluster; evidence: MappedPassage[]; skills: string[] }
  | { kind: 'skills'; id: string; group: string; summary: string; items: string[]; terms: string[] }
  | { kind: 'contact'; id: string };

export type ChapterId = 'approach' | 'work' | 'contact';

export interface Chapter {
  id: ChapterId;
  /** Short name for the menu. */
  nav: string;
  title: string;
  lede: string;
  steps: Step[];
}

// ------------------------------------------------------------------ approach: one step, all principles
const passageByTitle = new Map(mappedPassages.map((p) => [p.title, p]));

function evidenceFor(title: string): MappedPassage {
  const passage = passageByTitle.get(title);
  // Fail the build rather than ship a principle pointing at nothing.
  if (!passage) throw new Error(`approach.ts: no map passage titled "${title}"`);
  return passage;
}

const principles: Principle[] = approach.principles.map((p) => ({ ...p, evidence: p.evidence.map(evidenceFor) }));

// ------------------------------------------------------------------ work: one step per area, in workOrder
const EVIDENCE_PER_CLUSTER = 3;

// Every skill in the CV appears in exactly one area's tools, so no tool shows up twice.
(() => {
  const listed = Object.values(toolsByArea).flat();
  const duplicates = listed.filter((t, i) => listed.indexOf(t) !== i);
  const missing = skills.flatMap((s) => s.items).filter((t) => !listed.includes(t));
  if (duplicates.length) throw new Error(`work.ts: listed in more than one area: ${duplicates.join(', ')}`);
  if (missing.length) throw new Error(`work.ts: skills not in any area: ${missing.join(', ')}`);
})();

/** Only tools that exist as labels on the map can light up. */
const termsOnMap = (tools: string[]) =>
  labels.filter((l) => tools.some((t) => t.toLowerCase() === l.term.toLowerCase())).map((l) => l.term);

function areaStep(key: (typeof workOrder)[number]): Step {
  const tools = toolsByArea[key];
  if (key === TECHNIQUES_KEY) {
    return { kind: 'skills', id: `work-${key}`, group: techniques.name, summary: techniques.summary, items: tools, terms: termsOnMap(tools) };
  }
  const cluster = clusters.find((c) => c.key === key);
  if (!cluster) throw new Error(`work.ts: no cluster with key "${key}" in map.json`);
  return {
    kind: 'cluster',
    id: `work-${key}`,
    cluster,
    evidence: mappedPassages
      .filter((p) => p.cluster === cluster.id && (p.kind === 'point' || p.kind === 'education'))
      .slice(0, EVIDENCE_PER_CLUSTER),
    skills: tools,
  };
}

const workSteps: Step[] = workOrder.map(areaStep);

// ------------------------------------------------------------------ chapters
export const chapters: Chapter[] = [
  {
    id: 'approach',
    nav: approach.title,
    title: approach.title,
    lede: '',
    steps: [{ kind: 'approach', id: 'approach', principles }],
  },
  {
    id: 'work',
    nav: 'Work',
    title: 'What I work on',
    lede: 'The areas the map found in my CV, plus the techniques that run through them.',
    steps: [{ kind: 'chapter', id: 'work', chapter: 'work' }, ...workSteps],
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

const TOKENS_SHOWN: { [K in Step['kind']]: (step: Extract<Step, { kind: K }>) => number } = {
  intro: () => 0,
  approach: (step) => sum([...new Set(step.principles.flatMap((p) => p.evidence.map((e) => e.id)))]),
  chapter: () => 0,
  cluster: (step) => sum(step.evidence.map((p) => p.id)),
  skills: (step) => sum([...new Set(labels.filter((l) => step.terms.includes(l.term)).flatMap((l) => l.passages))]),
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
