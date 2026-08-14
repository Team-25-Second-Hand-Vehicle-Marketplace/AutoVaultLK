import { NotFoundException } from '@nestjs/common';
import { NotificationEventHandler } from './notification-event.handler';
import { EmailTemplateService } from './email-template.service';
import { SesUnavailableError } from '../adapters/ses.adapter';
import type { Notification } from '../../../infrastructure/database/entities/notification.entity';

function pending(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    userId: 'u1',
    type: 'DEALER_VERIFIED',
    subject: 'Your AutoVault LK dealer account is verified',
    message: 'Hi there',
    payload: {},
    status: 'PENDING',
    sentAt: null,
    createdAt: new Date(),
    idempotencyKey: 'dealer-u1-approved',
    ...overrides,
  };
}

describe('NotificationEventHandler', () => {
  const user = { id: 'u1', name: 'Amal', email: 'amal@example.com', isActive: true };

  function makeHandler(opts?: {
    existing?: Notification | null;
    send?: () => Promise<void>;
  }) {
    const stored = new Map<string, Notification>();
    if (opts?.existing) stored.set(opts.existing.id, { ...opts.existing });

    const repository = {
      findByIdempotencyKey: jest.fn(async (key: string) =>
        [...stored.values()].find((row) => row.idempotencyKey === key) ?? null,
      ),
      findUser: jest.fn(async (id: string) => (id === user.id ? user : null)),
      createPending: jest.fn(async (data: Partial<Notification>) => {
        const row = pending({ id: 'n-new', ...data, status: 'PENDING' });
        stored.set(row.id, row);
        return row;
      }),
      markSent: jest.fn(async (id: string) => {
        const row = stored.get(id);
        if (row) {
          row.status = 'SENT';
          row.sentAt = new Date();
        }
      }),
      markFailed: jest.fn(async (id: string) => {
        const row = stored.get(id);
        if (row) row.status = 'FAILED';
      }),
      findById: jest.fn(async (id: string) => stored.get(id) ?? null),
    };
    const ses = { send: jest.fn(opts?.send ?? (async () => undefined)) };
    const handler = new NotificationEventHandler(
      repository as never,
      new EmailTemplateService(),
      ses as never,
    );
    return { handler, repository, ses };
  }

  const event = {
    type: 'DEALER_VERIFIED' as const,
    userId: 'u1',
    idempotencyKey: 'dealer-u1-approved',
    payload: {},
  };

  it('does not call SES when the idempotency key already SENT (FR-53)', async () => {
    const { handler, ses } = makeHandler({
      existing: pending({ status: 'SENT', sentAt: new Date() }),
    });
    const result = await handler.handle(event);
    expect(result.status).toBe('SENT');
    expect(ses.send).not.toHaveBeenCalled();
  });

  it('inserts, sends, and marks SENT when SES is skipped/succeeds', async () => {
    const { handler, ses, repository } = makeHandler();
    const result = await handler.handle(event);
    expect(repository.createPending).toHaveBeenCalled();
    expect(ses.send).toHaveBeenCalledWith('amal@example.com', expect.any(String), expect.any(String));
    expect(result.status).toBe('SENT');
  });

  it('marks FAILED when SES throws and still returns the row', async () => {
    const { handler, repository } = makeHandler({
      send: async () => {
        throw new SesUnavailableError('SES HTTP 503', 503);
      },
    });
    const result = await handler.handle(event);
    expect(repository.markFailed).toHaveBeenCalled();
    expect(result.status).toBe('FAILED');
  });

  it('rejects an unknown recipient', async () => {
    const { handler } = makeHandler();
    await expect(
      handler.handle({ ...event, userId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
