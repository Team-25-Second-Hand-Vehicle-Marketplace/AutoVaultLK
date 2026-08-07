import serverlessExpress from '@codegenie/serverless-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

let cachedServer: ReturnType<typeof serverlessExpress>;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.init();
  return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

export async function handler(event: unknown, context: unknown) {
  cachedServer ??= await bootstrap();
  return cachedServer(event, context);
}
