// "How I work": the principles behind the work, each tied to the CV passages that
// show it. Like passages, each has a short `title` (all phones show) and the full `text`.
// `evidence` names map passages by title; story.ts fails the build if one is missing.

export interface PrincipleSource {
  title: string;
  text: string;
  evidence: string[];
}

export const approach = {
  title: 'How I work',
  principles: [
    {
      title: 'Understand the problem, then measure',
      text: 'Not every problem has a known solution, so the first step is understanding its shape, then measuring the approaches that fit it.',
      evidence: ['AI research briefs', 'Conversational analytics', 'RAG with Qdrant and Pinecone'],
    },
    {
      title: 'Models for judgement, code for certainty',
      text: 'A language model is one component, not the system. Rules, types and validation handle anything that must be right; the model handles judgement, and its output is checked before anything acts on it. When the model fails or times out, the system still works.',
      evidence: ['Tool selection step', 'Agent tool contracts', 'Guarded financial data writes', 'Model routing and failover'],
    },
    {
      title: 'Proven, not assumed',
      text: 'Regression tests replay fixed conversation sets on every prompt, tool or model change. Model output varies, so each case runs several times against a pass rate, and a model grades replies whose wording can differ. Speed comes from design: one model call where there were several, caching what doesn’t change, and a small model wherever a big one isn’t needed.',
      evidence: ['Agent regression tests', 'Single-call extraction', 'Prompt caching', 'Model routing and failover'],
    },
    {
      title: 'Every turn is traceable',
      text: 'When something goes wrong, every turn can be traced to exactly what the model saw.',
      evidence: ['Prompt-assembly visualiser', 'Per-turn context'],
    },
  ] satisfies PrincipleSource[],
};
