-- pgvector: 384-dim embeddings (all-MiniLM-L6-v2)
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm: trigram matching for make/model typo correction.
-- Only make/model need this — small enums use hardcoded typo maps instead.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
