import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { InternalServiceGuard } from '../../src/common/guards/internal-service.guard';
import { SqsPublisher } from '../../src/infrastructure/aws/sqs/sqs.publisher';
import { NotificationsController } from '../../src/modules/notifications/controllers/notifications.controller';

/**
 * Exercises POST /notifications/events the way admin-service and
 * ingestion-service call it: real routing, the real InternalServiceGuard and
 * the same ValidationPipe main.ts installs, with only the SQS publisher
 * stubbed.
 *
 * **The guard runs for real here**, against a ConfigService stubbed to hold a
 * known key. This endpoint accepts an arbitrary userId and queues an email to
 * whoever that is, so the shared-secret check is the only thing preventing it
 * from being used to send mail to any user in the system. A unit test can
 * assert the guard's own logic; only this suite proves it is actually attached
 * to the route.
 */

const INTERNAL_KEY = 'test-internal-service-key';
const HEADER = 'x-internal-service-key';

const USER_ID = '5b132c13-c433-4066-9c90-a6307c61fe47';

const VALID_EVENT = {
  type: 'DEALER_VERIFIED',
  userId: USER_ID,
  idempotencyKey: `dealer.verified:${USER_ID}`,
};

describe('POST /notifications/events (e2e)', () => {
  let app: INestApplication;
  let publisher: { publish: jest.Mock };

  beforeAll(async () => {
    publisher = { publish: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: SqsPublisher, useValue: publisher },
        InternalServiceGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'INTERNAL_SERVICE_KEY' ? INTERNAL_KEY : undefined,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    publisher.publish.mockResolvedValue(undefined);
  });

  describe('internal service authentication', () => {
    it('401s a caller with no key', async () => {
      await request(app.getHttpServer())
        .post('/notifications/events')
        .send(VALID_EVENT)
        .expect(401);

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('401s a caller with the wrong key', async () => {
      await request(app.getHttpServer())
        .post('/notifications/events')
        .set(HEADER, 'not-the-key')
        .send(VALID_EVENT)
        .expect(401);

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    // The guard compares with timingSafeEqual, which throws on a length
    // mismatch unless the lengths are checked first. A key of a different
    // length must be a clean 401, not a 500.
    it('401s a key of a different length rather than erroring', async () => {
      await request(app.getHttpServer())
        .post('/notifications/events')
        .set(HEADER, 'short')
        .send(VALID_EVENT)
        .expect(401);
    });

    it('accepts the configured key', async () => {
      await request(app.getHttpServer())
        .post('/notifications/events')
        .set(HEADER, INTERNAL_KEY)
        .send(VALID_EVENT)
        .expect(202);
    });

    // The guard runs before the body is validated, so a malformed payload from
    // an unauthenticated caller must still be a 401 — otherwise the 400/401
    // split tells an attacker their key was accepted.
    it('401s an unauthenticated caller before validating the body', async () => {
      await request(app.getHttpServer())
        .post('/notifications/events')
        .send({ type: 'NONSENSE' })
        .expect(401);
    });
  });

  describe('event intake (FR-49)', () => {
    const authed = () =>
      request(app.getHttpServer())
        .post('/notifications/events')
        .set(HEADER, INTERNAL_KEY);

    it('queues the event and acknowledges with 202', async () => {
      const response = await authed().send(VALID_EVENT).expect(202);

      expect(response.body).toEqual({
        queued: true,
        idempotencyKey: VALID_EVENT.idempotencyKey,
      });
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DEALER_VERIFIED', userId: USER_ID }),
      );
    });

    // 202, not 201: the handler has queued the event, not delivered the email.
    // The dealer's mail is sent asynchronously by the SQS consumer.
    it('answers 202 Accepted rather than 201 Created', async () => {
      await authed().send(VALID_EVENT).expect(202);
    });

    it('carries the optional payload through to the queue', async () => {
      await authed()
        .send({ ...VALID_EVENT, payload: { jobId: 'job-1', validRecords: 34 } })
        .expect(202);

      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { jobId: 'job-1', validRecords: 34 },
        }),
      );
    });

    it.each([
      'UPLOAD_COMPLETED',
      'UPLOAD_FAILED',
      'DEALER_VERIFIED',
      'DEALER_REJECTED',
    ])('accepts the %s intake type', async (type) => {
      await authed()
        .send({ ...VALID_EVENT, type, idempotencyKey: `${type}:${USER_ID}` })
        .expect(202);
    });

    // Types the SQS consumer does not handle must be refused at the edge
    // rather than queued into a message nothing will ever process.
    it.each(['WELCOME', 'PASSWORD_RESET', 'LISTING_APPROVED'])(
      '400s the non-intake type %s',
      async (type) => {
        await authed()
          .send({ ...VALID_EVENT, type })
          .expect(400);

        expect(publisher.publish).not.toHaveBeenCalled();
      },
    );

    it('400s a non-UUID userId', async () => {
      await authed()
        .send({ ...VALID_EVENT, userId: 'someone' })
        .expect(400);

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('400s a missing idempotency key', async () => {
      const withoutKey = { type: VALID_EVENT.type, userId: VALID_EVENT.userId };

      await authed().send(withoutKey).expect(400);

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    // FR-53 leans on the key to avoid duplicate sends, so a key too short to
    // be distinctive is refused rather than silently collapsing two events.
    it('400s an idempotency key below the minimum length', async () => {
      await authed()
        .send({ ...VALID_EVENT, idempotencyKey: 'short' })
        .expect(400);
    });

    it('trims surrounding whitespace from the idempotency key', async () => {
      await authed()
        .send({
          ...VALID_EVENT,
          idempotencyKey: `  ${VALID_EVENT.idempotencyKey}  `,
        })
        .expect(202);

      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: VALID_EVENT.idempotencyKey }),
      );
    });

    it('400s an unknown body field', async () => {
      await authed()
        .send({ ...VALID_EVENT, subject: 'Custom subject' })
        .expect(400);

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    // The caller is another service, and a lost event means a dealer never
    // hears that their upload finished. A queue failure must surface, not be
    // swallowed into a cheerful 202.
    it('does not acknowledge when the queue rejects the event', async () => {
      publisher.publish.mockRejectedValue(new Error('SQS unavailable'));

      const response = await authed().send(VALID_EVENT);

      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(response.body).not.toMatchObject({ queued: true });
    });
  });
});
