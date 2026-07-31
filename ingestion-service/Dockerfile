# Default image target for the HTTP ingestion API.
# Most ETL Lambdas are zip-packaged, not containers — see docker/etl-zip-lambdas.Dockerfile.
# Dedicated container images for the two heavy-dependency Lambdas (embed, process-images)
# live in docker/embed.Dockerfile and docker/process-images.Dockerfile.
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
COPY --from=build /app/dist ./dist
CMD ["dist/lambda/ingest-api.handler"]
