import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // Same wiring as the other services (see marketplace-service/src/main.ts).
  // transform: true is what actually coerces incoming values via @Type(), so a
  // multipart field arrives as a number rather than the string "250"; whitelist
  // strips undeclared properties; forbidNonWhitelisted 400s on unknown fields
  // instead of ignoring them. The upload DTOs rely on all three, and the e2e
  // suites replicate this block, so it must stay in sync.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // INGESTION_PORT first: .env.example sets PORT=3001 globally for the auth
  // service, so reading PORT alone would collide with it. 3003 matches the
  // ingestion_service upstream in api-gateway/local/nginx.conf.
  const port = process.env.INGESTION_PORT ?? process.env.PORT ?? 3003;
  await app.listen(port);

  console.log(`ingestion-service listening on ${port}`);
}

bootstrap();
