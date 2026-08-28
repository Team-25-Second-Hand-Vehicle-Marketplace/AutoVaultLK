import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNotificationEventDto } from '../../../../src/modules/notifications/dto/create-notification-event.dto';

describe('CreateNotificationEventDto', () => {
  async function check(plain: Record<string, unknown>) {
    return validate(plainToInstance(CreateNotificationEventDto, plain));
  }

  const valid = {
    type: 'DEALER_VERIFIED',
    userId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'dealer-verified-u1',
  };

  it('accepts the v1 intake whitelist', async () => {
    for (const type of ['UPLOAD_COMPLETED', 'UPLOAD_FAILED', 'DEALER_VERIFIED', 'DEALER_REJECTED']) {
      await expect(check({ ...valid, type })).resolves.toHaveLength(0);
    }
  });

  it('rejects WELCOME / PASSWORD_RESET / listing types (auth owns those mails)', async () => {
    for (const type of ['WELCOME', 'PASSWORD_RESET', 'LISTING_APPROVED', 'LISTING_REJECTED']) {
      const errors = await check({ ...valid, type });
      expect(errors.some((e) => e.property === 'type')).toBe(true);
    }
  });

  it('rejects a missing userId, short idempotency key, and non-object payload', async () => {
    const missingUser = await check({ type: 'DEALER_VERIFIED', idempotencyKey: 'dealer-verified-u1' });
    expect(missingUser.some((e) => e.property === 'userId')).toBe(true);

    const shortKey = await check({ ...valid, idempotencyKey: 'short' });
    expect(shortKey.some((e) => e.property === 'idempotencyKey')).toBe(true);

    const badPayload = await check({ ...valid, payload: 'not-an-object' });
    expect(badPayload.some((e) => e.property === 'payload')).toBe(true);
  });
});
