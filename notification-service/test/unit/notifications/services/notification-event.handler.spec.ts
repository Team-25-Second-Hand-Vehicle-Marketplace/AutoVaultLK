import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  MAX_DELIVERY_ATTEMPTS,
  NotificationEventHandler,
  backoffMs,
} from '../../../../src/modules/notifications/services/notification-event.handler';
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
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    ...overrides,
  };
}

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError('INSERT', [], { code: '23505' } as never);
}

describe('NotificationEventHandler', () => {
  const user = {
    id: 'u1',
    name: 'Amal',
    email: 'amal@example.com',
    isActive: true,
  };

  function makeHandler(opts?: {
    existing?: Notification | null;
    send?: () => Promise<void>;
    createPending?: () => Promise<Notification>;
  }) {
    const stored = new Map<string, Notification>();
    if (opts?.existing) stored.set(opts.existing.id, { ...opts.existing });

    const repository = {
      findByIdempotencyKey: jest.fn(
        async (key: string) =>
          [...stored.values()].find((row) => row.idempotencyKey === key) ??
          null,
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
      markFailed: jest.fn(async (id: string, lastError?: string) => {
        const row = stored.get(id);
        if (row) {
          row.status = 'FAILED';
          row.nextAttemptAt = null;
          if (lastError !== undefined) row.lastError = lastError;
        }
      }),
      scheduleRetry: jest.fn(
        async (
          id: string,
          attemptCount: number,
          nextAttemptAt: Date,
          lastError: string,
        ) => {
          const row = stored.get(id);
          if (row) {
            row.status = 'PENDING';
            row.attemptCount = attemptCount;
            row.nextAttemptAt = nextAttemptAt;
            row.lastError = lastError;
          }
        },
      ),
      claimDueRetries: jest.fn(async () => []),
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
    expect(ses.send).toHaveBeenCalledWith(
      'amal@example.com',
      expect.any(String),
      expect.any(String),
    );
    expect(result.status).toBe('SENT');
  });

  it('does not send twice when a unique-key race finds an already SENT row', async () => {
    const raced = pending({ id: 'raced', status: 'SENT', sentAt: new Date() });
    const { handler, ses, repository } = makeHandler({
      createPending: async () => {
        throw uniqueViolation();
      },
    });
    repository.findByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);

    const result = await handler.handle(event);
    expect(result.status).toBe('SENT');
    expect(ses.send).not.toHaveBeenCalled();
  });

  // Was "marks FAILED when SES throws". A transient failure is no longer
  // terminal: FR-53 requires it to be retried, so the row stays PENDING with a
  // scheduled next attempt. Marking it FAILED here was what silently dropped
  // every notification raised during an SES outage.
  it('schedules a retry when SES is transiently unavailable', async () => {
    const { handler, repository } = makeHandler({
      send: async () => {
        throw new SesUnavailableError('SES HTTP 503', 503);
      },
    });

    const result = await handler.handle(event);

    expect(repository.scheduleRetry).toHaveBeenCalledWith(
      'n-new',
      1,
      expect.any(Date),
      'SES HTTP 503',
    );
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING');
  });

  it('schedules the next attempt in the future', async () => {
    const { handler, repository } = makeHandler({
      send: async () => {
        throw new SesUnavailableError('SES HTTP 503', 503);
      },
    });

    const before = Date.now();
    await handler.handle(event);

    const [, , nextAttemptAt] = repository.scheduleRetry.mock.calls[0];
    expect(nextAttemptAt.getTime()).toBeGreaterThan(before);
  });

  // The queue must not redeliver a message whose row is already scheduled, or
  // the notification is attempted from two directions at once.
  it('does not rethrow a transient failure', async () => {
    const { handler } = makeHandler({
      send: async () => {
        throw new SesUnavailableError('SES HTTP 503', 503);
      },
    });

    await expect(handler.handle(event)).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('gives up and marks FAILED once the attempt budget is exhausted', async () => {
    const { handler, repository } = makeHandler({
      existing: pending({
        status: 'PENDING',
        attemptCount: MAX_DELIVERY_ATTEMPTS - 1,
      }),
      send: async () => {
        throw new SesUnavailableError('SES HTTP 503', 503);
      },
    });

    const result = await handler.handle(event);

    expect(repository.markFailed).toHaveBeenCalledWith('n1', 'SES HTTP 503');
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(result.status).toBe('FAILED');
  });

  it('counts the attempt from the row rather than restarting at one', async () => {
    const { handler, repository } = makeHandler({
      existing: pending({ status: 'PENDING', attemptCount: 2 }),
      send: async () => {
        throw new SesUnavailableError('SES HTTP 503', 503);
      },
    });

    await handler.handle(event);

    expect(repository.scheduleRetry).toHaveBeenCalledWith(
      'n1',
      3,
      expect.any(Date),
      expect.any(String),
    );
  });

  // A defect or a malformed address will not resolve itself, so retrying it
  // would burn the budget on an outcome that cannot change.
  it('marks a permanent failure FAILED without scheduling a retry', async () => {
    const { handler, repository } = makeHandler({
      send: async () => {
        throw new Error('socket hang up');
      },
    });

    await expect(handler.handle(event)).rejects.toThrow('socket hang up');
    expect(repository.markFailed).toHaveBeenCalledWith(
      'n-new',
      'socket hang up',
    );
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
  });

  it('records the failure reason for diagnosis', async () => {
    const { handler, repository } = makeHandler({
      send: async () => {
        throw new SesUnavailableError('SES HTTP 503', 503);
      },
    });

    await handler.handle(event);

    const [, , , lastError] = repository.scheduleRetry.mock.calls[0];
    expect(lastError).toBe('SES HTTP 503');
  });

  // The whole point of the retry: a row scheduled earlier must deliver when
  // SES recovers, and must not be re-inserted as a second notification.
  it('delivers a previously-scheduled row on a later attempt', async () => {
    const { handler, repository, ses } = makeHandler({
      existing: pending({
        status: 'PENDING',
        attemptCount: 2,
        nextAttemptAt: new Date(Date.now() - 1000),
        lastError: 'SES HTTP 503',
      }),
    });

    const result = await handler.handle(event);

    expect(repository.createPending).not.toHaveBeenCalled();
    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SENT');
  });

  it('never sends twice for a row that already succeeded', async () => {
    // deliver() re-checks the status rather than trusting the row it was
    // handed: the sweeper may be working from a read taken moments ago.
    const { handler, ses } = makeHandler({
      existing: pending({
        status: 'SENT',
        sentAt: new Date(),
        attemptCount: 3,
      }),
    });

    await handler.deliver(pending({ status: 'SENT', sentAt: new Date() }));

    expect(ses.send).not.toHaveBeenCalled();
  });

  describe('backoffMs', () => {
    it('grows with each attempt', async () => {
      // Compared at the floor of each band, since jitter adds up to 20%.
      expect(backoffMs(1)).toBeLessThan(backoffMs(3));
      expect(backoffMs(2)).toBeLessThan(backoffMs(4));
    });

    it('caps so a late attempt does not wait for hours', () => {
      // 15 minutes, plus at most 20% jitter.
      expect(backoffMs(20)).toBeLessThanOrEqual(15 * 60_000 * 1.2);
    });

    // An outage fails every in-flight notification at once; without jitter
    // they would all retry in the same instant and re-synchronise on every
    // subsequent attempt.
    it('applies jitter so a batch does not retry in lockstep', () => {
      const samples = new Set(Array.from({ length: 20 }, () => backoffMs(3)));

      expect(samples.size).toBeGreaterThan(1);
    });
  });

  it('rejects an unknown recipient', async () => {
    const { handler } = makeHandler();
    await expect(
      handler.handle({ ...event, userId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
