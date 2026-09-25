import serverlessExpress from '@codegenie/serverless-express';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JobStatusAppModule } from '../job-status-app.module';

let cachedServer: ReturnType<typeof serverlessExpress>;

async function bootstrap() {
  const app = await NestFactory.create(JobStatusAppModule);
  app.enableCors();

  // Mirrors ingest-api.ts / main.ts exactly.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();
  return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

// This service's controller is @Controller('jobs'), matching the API
// Gateway route key exactly — see ingest-api.ts's equivalent note.
export async function handler(event: unknown, context: unknown) {
  cachedServer ??= await bootstrap();
  return cachedServer(event, context);
}
