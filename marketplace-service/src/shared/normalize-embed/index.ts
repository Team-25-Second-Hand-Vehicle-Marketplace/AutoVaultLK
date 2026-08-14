/**
 * Shared MiniLM embed helper (FR-22.1 / NFR-26.1).
 *
 * Lives here so marketplace search and (later) ingestion EmbedHandler call
 * the same model id, pooling, and L2 normalization. Do not re-declare
 * EMBEDDING_DIMENSIONS or EMBEDDING_MODEL_ID in either service.
 */
export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from './constants';
export { assertEmbedding, l2Normalize, toPgVector } from './vector';
export { createXenovaEmbedder } from './embedder';
export type { Embedder } from './embedder';
