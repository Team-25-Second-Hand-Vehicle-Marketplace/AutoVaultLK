# Build-only image, not a deployment artifact.
# The 9 zip-packaged ETL Lambdas (validate-file, split-chunks, parse-normalize,
# groq-normalize, validate-rows, enrich, load, aggregate-results, notify) share
# no native/heavy dependencies, so they are deployed as plain zip Lambda packages,
# not container images. This Dockerfile only produces the shared `dist/` build
# output used to package each one; CI zips `dist/lambda/<name>` per function
# rather than running this image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build
