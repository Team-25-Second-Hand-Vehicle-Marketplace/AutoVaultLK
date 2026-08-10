import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { createValidationPipe } from '../validation/validation-pipe.config';
import {
  getHttpJsonBodyLimit,
  parseAllowedOrigins,
} from '../../config/http-security.config';
import { ProductionExceptionFilter } from './production-exception.filter';

export function configureHttpSecurity(app: INestApplication) {
  const configService = app.get(ConfigService);
  const allowedOrigins = parseAllowedOrigins(
    configService.get<string>('CORS_ORIGINS'),
  );

  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cookieParser());
  const bodyLimit = getHttpJsonBodyLimit(configService);
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  app.enableCors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS policy'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-CSRF-Token',
      'X-Device-Label',
      'X-Request-ID',
    ],
    exposedHeaders: ['X-Request-ID'],
  });

  app.useGlobalFilters(new ProductionExceptionFilter(configService));
  app.useGlobalPipes(createValidationPipe());
}
