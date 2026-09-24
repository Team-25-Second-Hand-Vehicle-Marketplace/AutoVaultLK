import serverlessExpress from '@codegenie/serverless-express';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

let cachedServer: ReturnType<typeof serverlessExpress>;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // Mirrors main.ts exactly (see the comment there on why all three flags
  // matter — the upload DTOs and e2e suites depend on this staying in sync).
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

// No prefix-stripping needed here, unlike marketplace-api.ts: this service's
// own controllers are already @Controller('ingest') and @Controller('jobs'),
// matching the API Gateway route keys exactly, so whatever path hits the
// gateway is exactly what these controllers expect.
export async function handler(event: unknown, context: unknown) {
  cachedServer ??= await bootstrap();
  return cachedServer(event, context);
}
