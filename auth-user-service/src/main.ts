import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpSecurity } from './common/security/configure-http-security';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureHttpSecurity(app);
  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
