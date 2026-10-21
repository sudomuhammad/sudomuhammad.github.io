// Loads the map's sentence model in the browser on first use. The library and model
// are fetched lazily, so visitors who never ask a question download none of it.
import { model } from '../../data/map';

export type LoadStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number }
  | { state: 'ready' }
  | { state: 'failed'; error: string };

type Embedder = (text: string) => Promise<Float32Array>;

let loading: Promise<Embedder> | null = null;

/**
 * Resolves to an embedding function using the exact model file the build used
 * (same repo, revision and quantisation), so query vectors match the passages'.
 */
export function loadEmbedder(onStatus: (status: LoadStatus) => void): Promise<Embedder> {
  loading ??= (async () => {
    onStatus({ state: 'loading', progress: 0 });
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    // Pin every request to the build's commit. Transformers.js 4.3 reads config.json
    // before applying the `revision` option (get_pipeline_files ignores it), so the
    // option alone would still fetch some files from `main`.
    env.remotePathTemplate = `{model}/resolve/${model.revision}/`;
    const extractor = await pipeline('feature-extraction', model.repo, {
      revision: model.revision,
      dtype: 'q8', // onnx/model_quantized.onnx, as in ml/build_map.py
      progress_callback: (info: { status: string; progress?: number }) => {
        if (info.status === 'progress_total' && typeof info.progress === 'number') {
          onStatus({ state: 'loading', progress: info.progress });
        }
      },
    });
    onStatus({ state: 'ready' });
    // Pooling and the query instruction come from map.json, as ml/build_map.py used them.
    const pooling = model.pooling as 'mean' | 'cls';
    return async (text: string) => {
      const output = await extractor(model.queryPrefix + text, { pooling, normalize: true });
      return output.data as Float32Array;
    };
  })().catch((error: unknown) => {
    loading = null; // allow a retry on the next question
    onStatus({ state: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  });
  return loading;
}
