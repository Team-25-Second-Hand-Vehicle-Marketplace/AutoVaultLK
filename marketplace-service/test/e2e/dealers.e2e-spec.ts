import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DealerModule } from '../../src/modules/dealers/dealer.module';
import { DealerRepository } from '../../src/modules/dealers/repositories/dealer.repository';
import { AuthUserView } from '../../src/infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../src/infrastructure/database/entities/dealer-profile.view-entity';

/**
 * The dealer routes are public reads plus one write that is deliberately not
 * implemented here. Two things are worth pinning at the HTTP boundary:
 * ParseUUIDPipe turning a malformed id into a 400 rather than a database
 * error, and the 501 on the profile update.
 *
 * That 501 is the important one. `PUT /dealers/:id/profile` has no guard and a
 * DTO that would rewrite a dealer's business name, email and address — it looks
 * exactly like an unguarded write, and the only thing stopping it is that
 * DealerService throws NotImplementedException because profile updates are
 * owned by auth-user-service. Someone will eventually "fix" this by
 * implementing it rather than removing it; this test states the intent.
 */

const DEALER_ID = '9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d';

describe('dealers (e2e)', () => {
  let app: INestApplication;
  let repository: { findById: jest.Mock; findProfile: jest.Mock };

  beforeAll(async () => {
    repository = { findById: jest.fn(), findProfile: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DealerModule],
    })
      .overrideProvider(DealerRepository)
      .useValue(repository)
      .overrideProvider(getRepositoryToken(AuthUserView))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(DealerProfileView))
      .useValue({ findOne: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('GET /dealers/:id/profile', () => {
    it('returns the profile', async () => {
      // Both GETs route through DealerService.getProfile, which calls
      // findById — getDealerById is an alias for it.
      repository.findById.mockResolvedValue({ id: DEALER_ID, companyName: 'AutoLanka' });

      const response = await request(app.getHttpServer())
        .get(`/dealers/${DEALER_ID}/profile`)
        .expect(200);

      expect(response.body).toMatchObject({ companyName: 'AutoLanka' });
    });

    it('404s an unknown dealer', async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer()).get(`/dealers/${DEALER_ID}/profile`).expect(404);
    });

    it('400s a non-UUID id before reaching the repository', async () => {
      await request(app.getHttpServer()).get('/dealers/not-a-uuid/profile').expect(400);

      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('is public', async () => {
      // Buyers browse dealer profiles without signing in.
      repository.findById.mockResolvedValue({ id: DEALER_ID });

      await request(app.getHttpServer()).get(`/dealers/${DEALER_ID}/profile`).expect(200);
    });
  });

  describe('GET /dealers/:id', () => {
    it('returns the dealer', async () => {
      repository.findById.mockResolvedValue({ id: DEALER_ID });

      await request(app.getHttpServer()).get(`/dealers/${DEALER_ID}`).expect(200);
    });

    it('404s an unknown dealer', async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer()).get(`/dealers/${DEALER_ID}`).expect(404);
    });

    it('routes :id and :id/profile to their own handlers', async () => {
      // Both end at findById today — getDealerById simply delegates to
      // getProfile — so this pins that both paths resolve rather than one
      // shadowing the other.
      repository.findById.mockResolvedValue({ id: DEALER_ID });

      await request(app.getHttpServer()).get(`/dealers/${DEALER_ID}`).expect(200);
      await request(app.getHttpServer()).get(`/dealers/${DEALER_ID}/profile`).expect(200);
    });
  });

  describe('PUT /dealers/:id/profile', () => {
    it('501s — profile updates are owned by auth-user-service', async () => {
      // Not a gap in this suite: the handler exists, is unguarded, and refuses
      // to act. Implementing it here would create an unauthenticated write to
      // dealer identity. If this test starts failing, check why before making
      // it pass.
      const response = await request(app.getHttpServer())
        .put(`/dealers/${DEALER_ID}/profile`)
        .send({ businessName: 'Changed' })
        .expect(501);

      expect(response.body.message).toMatch(/auth-user-service/i);
    });

    it('400s a malformed body before the 501', async () => {
      await request(app.getHttpServer())
        .put(`/dealers/${DEALER_ID}/profile`)
        .send({ notAField: 'x' })
        .expect(400);
    });

    it('400s a non-UUID id', async () => {
      await request(app.getHttpServer())
        .put('/dealers/not-a-uuid/profile')
        .send({ businessName: 'Changed' })
        .expect(400);
    });
  });
});
