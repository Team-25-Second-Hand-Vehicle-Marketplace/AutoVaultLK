import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ProductionExceptionFilter } from './common/filters/production-exception.filter';
import { buildCorsOptions, parseAllowedOrigins } from './config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const allowedOrigins = parseAllowedOrigins(configService.get<string>('CORS_ORIGINS'));
  app.enableCors(buildCorsOptions(allowedOrigins));
  app.useGlobalFilters(new ProductionExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const port = process.env.ADMIN_PORT ?? process.env.PORT ?? 3004;
  await app.listen(port);
}

bootstrap();
