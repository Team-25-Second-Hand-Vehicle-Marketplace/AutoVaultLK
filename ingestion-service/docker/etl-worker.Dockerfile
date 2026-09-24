# Container image — MVP deployment path (production/README.md). Runs the
# whole ETL pipeline (LocalOrchestrator, including the Groq, embedding and
# image-processing stages) in one Lambda invocation per job, SQS-triggered,
# rather than the one-Lambda-per-stage Step Functions design. Same reason as
# embed.Dockerfile and process-images.Dockerfile: this needs both the MiniLM
# ONNX runtime and Sharp's native binary, so it gets the same two-stage build
# — node_modules is installed fresh in the Lambda base image, never copied
# from the Alpine build stage, avoiding a glibc/musl mismatch.
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
CMD ["dist/lambda/etl-worker.handler"]
