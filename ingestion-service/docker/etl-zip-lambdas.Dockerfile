# Build-only image, not a deployment artifact.
# The zip-packaged ETL Lambdas — validate-file, split-chunks, parse-normalize,
# groq-normalize, validate-rows, enrich, load, aggregate-results,
# mark-job-failed and notify — share no native or heavy dependencies, so they
# are deployed as plain zip packages rather than container images. embed is the
# exception: the MiniLM ONNX model alone is ~90MB against a 250MB unzipped
# layer cap, so it gets docker/embed.Dockerfile. This Dockerfile only produces the shared `dist/` build
# output used to package each one; CI zips `dist/lambda/<name>` per function
# rather than running this image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build
