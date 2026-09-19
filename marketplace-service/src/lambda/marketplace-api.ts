import serverlessExpress from '@codegenie/serverless-express';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

let cachedServer: ReturnType<typeof serverlessExpress>;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // Mirrors main.ts exactly — transform: true is what turns query-string
  // "true"/"2015" into real boolean/number before service code sees them.
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

// nginx strips the /marketplace prefix before forwarding locally (this
// service's own routes have no such prefix — e.g. ListingController is
// @Controller('listings'), not @Controller('marketplace/listings')). API
// Gateway's Lambda-proxy integration has no path-rewrite capability of its
// own, so the same stripping has to happen here instead.
type ApiGatewayV2Event = {
  rawPath?: string;
  requestContext?: { http?: { path?: string } };
};

function stripMarketplacePrefix(event: unknown): unknown {
  const e = event as ApiGatewayV2Event;
  if (typeof e?.rawPath === 'string' && e.rawPath.startsWith('/marketplace')) {
    e.rawPath = e.rawPath.slice('/marketplace'.length) || '/';
    if (e.requestContext?.http) {
      e.requestContext.http.path = e.rawPath;
    }
  }
  return event;
}

export async function handler(event: unknown, context: unknown) {
  cachedServer ??= await bootstrap();
  return cachedServer(stripMarketplacePrefix(event), context);
}
