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

# Bake the MiniLM model into the image. Without this the first request on every
# cold start downloads it from Hugging Face (10s+), which made create-listing
# time out. The runtime (embedder.ts) reads it from EMBEDDING_MODEL_CACHE_DIR.
ENV EMBEDDING_MODEL_CACHE_DIR=${LAMBDA_TASK_ROOT}/model-cache
COPY scripts/download-model.cjs ./scripts/download-model.cjs
RUN node scripts/download-model.cjs

COPY --from=build /app/dist ./dist
CMD ["dist/lambda/marketplace-api.handler"]
