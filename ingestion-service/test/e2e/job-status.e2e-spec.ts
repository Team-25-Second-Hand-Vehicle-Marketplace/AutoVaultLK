import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { JobStatusController } from '../../src/modules/job-status/controllers/job-status.controller';
import { JobStatusService } from '../../src/modules/job-status/services/job-status.service';
import { JobStatusRepository } from '../../src/modules/job-status/repositories/job-status.repository';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../src/modules/auth/types/authenticated-user.type';

/**
 * Exercises GET /jobs/{id} the way the dealer's status page uses it: real
 * routing, real ParseUUIDPipe, real ValidationPipe, with only the repository
 * stubbed.
 *
 * The route is `/jobs`, not `/upload-jobs` — api-gateway/openapi/public-api.yaml
 * publishes GET /jobs/{jobId} and nginx proxies `location /jobs/` WITHOUT
 * stripping the prefix, so the path the service sees includes it. That mismatch
 * was a live 404 once; this suite pins it.
 */

const DEALER_ID = '3f6f6b4e-1c2d-4a5b-8c9d-0e1f2a3b4c5d';
const JOB_ID = '9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d';

const DEALER: AuthenticatedUser = {
  id: DEALER_ID,
  email: 'dealer@example.com',
  role: 'DEALER',
} as AuthenticatedUser;

const JOB = {
  id: JOB_ID,
  status: 'PARTIAL',
  fileName: 'stock.csv',
  totalRecords: 40,
  validRecords: 34,
  invalidRecords: 6,
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  updatedAt: new Date('2026-09-01T10:02:00.000Z'),
};

describe('GET /jobs/:id (e2e)', () => {
  let app: INestApplication;
  let repository: { findById: jest.Mock };
  let authenticated = true;

  beforeAll(async () => {
    repository = { findById: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [JobStatusController],
      providers: [
        JobStatusService,
        { provide: JobStatusRepository, useValue: repository },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: AuthenticatedUser } };
        }) => {
          if (!authenticated) return false;
          ctx.switchToHttp().getRequest().user = DEALER;
          return true;
        },
      })
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

  beforeEach(() => {
    authenticated = true;
    jest.clearAllMocks();
  });

  it('returns the job with the counts the status page renders', async () => {
    repository.findById.mockResolvedValue(JOB);

    const response = await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: JOB_ID,
      status: 'PARTIAL',
      fileName: 'stock.csv',
      totalRecords: 40,
      validRecords: 34,
      invalidRecords: 6,
    });
  });

  it('scopes the lookup to the caller', async () => {
    // The dealer id comes from the verified token, never from the request, so
    // a dealer cannot read another dealer's job by guessing an id.
    repository.findById.mockResolvedValue(JOB);

    await request(app.getHttpServer()).get(`/jobs/${JOB_ID}`).expect(200);

    expect(repository.findById).toHaveBeenCalledWith(JOB_ID, DEALER_ID);
  });

  it('404s another dealer\'s job rather than 403', async () => {
    // 403 would confirm the job exists. 404 leaks nothing: an id that is not
    // yours is indistinguishable from an id that does not exist.
    repository.findById.mockResolvedValue(null);

    await request(app.getHttpServer()).get(`/jobs/${JOB_ID}`).expect(404);
  });

  it('404s an unknown job', async () => {
    repository.findById.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/jobs/11111111-2222-4333-8444-555555555555')
      .expect(404);
  });

  it('400s a malformed id before reaching the repository', async () => {
    // ParseUUIDPipe. Without it the id would reach Postgres and raise a
    // 22P02 invalid-input error, surfacing as a 500.
    await request(app.getHttpServer()).get('/jobs/not-a-uuid').expect(400);

    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    authenticated = false;

    await request(app.getHttpServer()).get(`/jobs/${JOB_ID}`).expect(403);

    expect(repository.findById).not.toHaveBeenCalled();
  });
});
