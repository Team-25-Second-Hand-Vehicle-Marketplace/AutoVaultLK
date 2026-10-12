# Container image - the embed Lambda carries the MiniLM model and its
# ONNX/transformers runtime, which exceeds the zip Lambda package size limit
# (250MB unzipped, including layers). Deployed at 3008MB memory.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM public.ecr.aws/lambda/nodejs:22
WORKDIR ${LAMBDA_TASK_ROOT}
COPY package*.json ./
RUN npm ci --omit=dev

# Bake the MiniLM model into the image. Without this the embed stage's first
# call on every cold start tries to download it from Hugging Face and write
# it under node_modules, which fails - only /tmp is writable at runtime. The
# runtime (embedder.ts) reads it from EMBEDDING_MODEL_CACHE_DIR.
ENV EMBEDDING_MODEL_CACHE_DIR=${LAMBDA_TASK_ROOT}/model-cache
COPY scripts/download-model.cjs ./scripts/download-model.cjs
RUN node scripts/download-model.cjs

COPY --from=build /app/dist ./dist
CMD ["dist/lambda/embed.handler"]
