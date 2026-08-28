import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { NotificationEventHandler } from '../../../../src/modules/notifications/services/notification-event.handler';
import { EmailTemplateService } from '../../../../src/modules/notifications/services/email-template.service';
import { SesUnavailableError } from '../../../../src/modules/notifications/adapters/ses.adapter';
import type { Notification } from '../../../../src/infrastructure/database/entities/notification.entity';

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

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError('INSERT', [], { code: '23505' } as never);
}

describe('NotificationEventHandler', () => {
  const user = { id: 'u1', name: 'Amal', email: 'amal@example.com', isActive: true };

  function makeHandler(opts?: {
    existing?: Notification | null;
    send?: () => Promise<void>;
    createPending?: () => Promise<Notification>;
  }) {
    const stored = new Map<string, Notification>();
    if (opts?.existing) stored.set(opts.existing.id, { ...opts.existing });

    const repository = {
      findByIdempotencyKey: jest.fn(async (key: string) =>
        [...stored.values()].find((row) => row.idempotencyKey === key) ?? null,
      ),
      findUser: jest.fn(async (id: string) => (id === user.id ? user : null)),
      createPending: jest.fn(
        opts?.createPending ??
          (async (data: Partial<Notification>) => {
            const row = pending({ id: 'n-new', ...data, status: 'PENDING' });
            stored.set(row.id, row);
            return row;
          }),
      ),
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

  it('retries delivery for a FAILED row without inserting a second pending', async () => {
    const { handler, ses, repository } = makeHandler({
      existing: pending({ status: 'FAILED' }),
    });
    const result = await handler.handle(event);
    expect(repository.createPending).not.toHaveBeenCalled();
    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SENT');
  });

  it('inserts, sends, and marks SENT when SES is skipped/succeeds', async () => {
    const { handler, ses, repository } = makeHandler();
    const result = await handler.handle(event);
    expect(repository.createPending).toHaveBeenCalled();
    expect(ses.send).toHaveBeenCalledWith('amal@example.com', expect.any(String), expect.any(String));
    expect(result.status).toBe('SENT');
  });

  it('does not send twice when a unique-key race finds an already SENT row', async () => {
    const raced = pending({ id: 'raced', status: 'SENT', sentAt: new Date() });
    const { handler, ses, repository } = makeHandler({
      createPending: async () => {
        throw uniqueViolation();
      },
    });
    repository.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);

    const result = await handler.handle(event);
    expect(result.status).toBe('SENT');
    expect(ses.send).not.toHaveBeenCalled();
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

  it('rethrows unexpected SES errors after marking FAILED', async () => {
    const { handler, repository } = makeHandler({
      send: async () => {
        throw new Error('socket hang up');
      },
    });
    await expect(handler.handle(event)).rejects.toThrow('socket hang up');
    expect(repository.markFailed).toHaveBeenCalled();
  });

  it('rejects an unknown recipient', async () => {
    const { handler } = makeHandler();
    await expect(
      handler.handle({ ...event, userId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
