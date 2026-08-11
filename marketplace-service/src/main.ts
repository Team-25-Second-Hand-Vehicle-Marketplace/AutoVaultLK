import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // MARKETPLACE_PORT first: the repo root .env is shared by all five
  // services, so its single PORT value cannot address more than one of
  // them. Falls back to PORT, then to the nginx upstream's 3002
  // (api-gateway/local/nginx.conf).
  const port = process.env.MARKETPLACE_PORT ?? process.env.PORT ?? 3002;
  await app.listen(port);

  console.log(`marketplace-service listening on ${port}`);
}

bootstrap();
