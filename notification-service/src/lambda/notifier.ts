import serverlessExpress from '@codegenie/serverless-express';
import { INestApplicationContext, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { NotificationRetrySweeper } from '../modules/notifications/services/notification-retry.sweeper';

type CachedApp = {
  app: INestApplicationContext;
  server: ReturnType<typeof serverlessExpress>;
};

let cached: CachedApp;

async function bootstrap(): Promise<CachedApp> {
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
  const server = serverlessExpress({ app: app.getHttpAdapter().getInstance() });
  return { app, server };
}

/**
 * EventBridge's scheduled input, set by the Terraform rule that drives FR-53
 * in production. `NotificationRetrySweeper`'s own `setInterval` never fires
 * reliably here — Lambda freezes the process between invocations, so a timer
 * only ever ticks during the brief window a request happens to be in flight.
 * This is the actual trigger; the in-process interval stays as the local/
 * long-lived-process path (`NOTIFICATION_RETRY_ENABLED=false` disables it in
 * this deployment so it isn't silently doing nothing).
 */
type ScheduledSweepEvent = { action: 'sweep-notifications' };

function isScheduledSweep(event: unknown): event is ScheduledSweepEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as Record<string, unknown>).action === 'sweep-notifications'
  );
}

export async function handler(event: unknown, context: unknown) {
  cached ??= await bootstrap();

  if (isScheduledSweep(event)) {
    const sweeper = cached.app.get(NotificationRetrySweeper);
    const delivered = await sweeper.sweep();
    return { delivered };
  }

  return cached.server(event, context);
}
