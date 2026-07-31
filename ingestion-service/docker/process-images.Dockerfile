# Container image — the process-images Lambda depends on Sharp, which ships
# native per-platform binaries. A container avoids Lambda-layer architecture
# pinning issues that Sharp is known for. Deployed at 2048MB memory.
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
CMD ["dist/lambda/process-images.handler"]
