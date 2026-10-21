// The "What I work on" chapter: the order of its areas and the tools each one lists.
// Areas are the clusters the map found (by key), plus "Tools and techniques", which
// isn't a cluster of its own. story.ts checks every skill in cv.json appears exactly
// once across these lists, so the same tool can't show up in two places.

export const TECHNIQUES_KEY = 'techniques';

/** Area keys, top to bottom. */
export const workOrder = ['agents', 'context', TECHNIQUES_KEY, 'shipping', 'nlp', 'data', 'systems'] as const;

export const techniques = {
  name: 'Tools and techniques',
  summary: 'The building blocks behind the language-model work above.',
};

export const toolsByArea: Record<(typeof workOrder)[number], string[]> = {
  agents: ['LangGraph', 'LangChain', 'LlamaIndex', 'CrewAI', 'Microsoft Agent Framework', 'Model Context Protocol', 'Pydantic', 'Azure AI Foundry'],
  context: ['context engineering', 'prompt caching', 'structured outputs'],
  techniques: ['RAG', 'tool calling', 'LLM evaluation', 'fine-tuning (LoRA/PEFT)', 'model routing'],
  shipping: ['Docker', 'AWS', 'CircleCI', 'OpenTelemetry'],
  nlp: ['embeddings and semantic search', 'text classification', 'named-entity recognition', 'sentiment analysis', 'topic modelling', 'transfer learning', 'Qdrant', 'Pinecone', 'Azure AI Search', 'Redis'],
  data: ['Python', 'NumPy', 'pandas', 'scikit-learn', 'PyTorch', 'TensorFlow', 'Hugging Face', 'statistical modelling', 'CNNs'],
  systems: ['PostgreSQL', 'MongoDB', 'Linux'],
};
