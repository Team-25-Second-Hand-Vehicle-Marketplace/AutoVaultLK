import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // Enforces every class-validator decorator across all DTOs (FilterSearchDto
  // included) and — critically — transform: true actually mutates incoming
  // query-string values via @Type(), so "true" becomes boolean true and
  // "2015" becomes number 2015 before any service code sees them. Without
  // this, validation runs against the string representation and passes, but
  // the values stay strings all the way through — which is why
  // dealerVerified and appliedFilters were showing quoted "true"/"2015".
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true, // strips any property not declared on the DTO
      forbidNonWhitelisted: true, // 400s on unknown query params instead of silently ignoring them
    }),
  );

  const port = process.env.MARKETPLACE_PORT ?? process.env.PORT ?? 3002;
  await app.listen(port);

  console.log(`marketplace-service listening on ${port}`);
}

bootstrap();
