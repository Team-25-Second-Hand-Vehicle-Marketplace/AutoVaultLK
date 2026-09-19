import serverlessExpress from '@codegenie/serverless-express';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

let cachedServer: ReturnType<typeof serverlessExpress>;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // Mirrors main.ts exactly.
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

export async function handler(event: unknown, context: unknown) {
  cachedServer ??= await bootstrap();
  return cachedServer(event, context);
}
