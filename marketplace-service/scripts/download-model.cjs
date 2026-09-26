// Runs at image build time: pulls the MiniLM model into EMBEDDING_MODEL_CACHE_DIR
// so cold starts read it from disk instead of downloading ~90MB from Hugging Face
// inside the first create-listing / search request.
const dir = process.env.EMBEDDING_MODEL_CACHE_DIR;
if (!dir) throw new Error('EMBEDDING_MODEL_CACHE_DIR must be set');

(async () => {
  const { env, pipeline } = await import('@xenova/transformers');
  env.cacheDir = dir;
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const out = await extractor('warm up', { pooling: 'mean', normalize: true });
  if (out.data.length !== 384) throw new Error(`unexpected embedding size ${out.data.length}`);
  console.log(`model cached in ${dir}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
