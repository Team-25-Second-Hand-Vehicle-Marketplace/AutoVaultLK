import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { JobStatusController } from '../../src/modules/job-status/controllers/job-status.controller';
import { JobStatusService } from '../../src/modules/job-status/services/job-status.service';
import { JobStatusRepository } from '../../src/modules/job-status/repositories/job-status.repository';
import { EtlStageLogRepository } from '../../src/modules/ingestion/repositories/etl-stage-log.repository';
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
};

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

// Shared by both suites below: one app, one stubbed repository. The status
// endpoint and its rejection report are the same controller and the same
// guard, so standing them up twice would only duplicate the wiring.
let app: INestApplication;
let repository: { findById: jest.Mock; findRejectedRecords: jest.Mock };
let stageLogRepository: { findForJob: jest.Mock };
let authenticated = true;

beforeAll(async () => {
  repository = { findById: jest.fn(), findRejectedRecords: jest.fn() };
  stageLogRepository = { findForJob: jest.fn() };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [JobStatusController],
    providers: [
      JobStatusService,
      { provide: JobStatusRepository, useValue: repository },
      { provide: EtlStageLogRepository, useValue: stageLogRepository },
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
  authenticated = true;
  jest.clearAllMocks();
});

describe('GET /jobs/:id (e2e)', () => {
  beforeEach(() => {
    stageLogRepository.findForJob.mockResolvedValue([]);
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

  it('reports per-stage progress from the ETL stage log', async () => {
    repository.findById.mockResolvedValue(JOB);
    stageLogRepository.findForJob.mockResolvedValue([
      {
        stage: 'VALIDATE_FILE',
        status: 'SUCCEEDED',
        chunkId: null,
        retryCount: 0,
        startedAt: new Date('2026-09-01T10:00:01.000Z'),
        completedAt: new Date('2026-09-01T10:00:02.000Z'),
        errorMessage: null,
      },
      {
        stage: 'GROQ_NORMALIZE',
        status: 'FAILED',
        chunkId: 3,
        retryCount: 1,
        startedAt: new Date('2026-09-01T10:00:05.000Z'),
        completedAt: null,
        errorMessage: 'Groq request timed out',
      },
    ]);

    const response = await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}`)
      .expect(200);

    expect(response.body.stages).toEqual([
      expect.objectContaining({
        stage: 'VALIDATE_FILE',
        status: 'SUCCEEDED',
        chunkId: null,
        retryCount: 0,
      }),
      expect.objectContaining({
        stage: 'GROQ_NORMALIZE',
        status: 'FAILED',
        chunkId: 3,
        retryCount: 1,
        errorMessage: 'Groq request timed out',
      }),
    ]);
    expect(stageLogRepository.findForJob).toHaveBeenCalledWith(JOB_ID);
  });

  it('scopes the lookup to the caller', async () => {
    // The dealer id comes from the verified token, never from the request, so
    // a dealer cannot read another dealer's job by guessing an id.
    repository.findById.mockResolvedValue(JOB);

    await request(app.getHttpServer()).get(`/jobs/${JOB_ID}`).expect(200);

    expect(repository.findById).toHaveBeenCalledWith(JOB_ID, DEALER_ID);
  });

  it("404s another dealer's job rather than 403", async () => {
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

/**
 * FR-57: the row-level report behind the aggregate counts. Same routing and
 * scoping rules as the status endpoint above — a job that is not yours is a
 * 404, and the dealer id comes from the token.
 */
describe('GET /jobs/:id/rejections (e2e)', () => {
  const REJECTION = {
    rowNumber: 17,
    stage: 'VALIDATE_ROWS',
    reason: 'manufacture_year 1972 is outside the accepted range',
    rawData: { registration: 'CAB-1234', manufacture_year: '1972' },
    createdAt: new Date('2026-09-01T10:03:00.000Z'),
  };

  beforeEach(() => {
    authenticated = true;
    jest.clearAllMocks();
    repository.findById.mockResolvedValue(JOB);
    repository.findRejectedRecords.mockResolvedValue({ rows: [], total: 0 });
  });

  it('returns the rejected rows with reasons and the submitted values', async () => {
    repository.findRejectedRecords.mockResolvedValue({
      rows: [REJECTION],
      total: 1,
    });

    const response = await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections`)
      .expect(200);

    expect(response.body).toMatchObject({
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
      items: [
        {
          rowNumber: 17,
          stage: 'VALIDATE_ROWS',
          reason: 'manufacture_year 1972 is outside the accepted range',
          rawData: { registration: 'CAB-1234', manufacture_year: '1972' },
          rawDataTruncated: false,
        },
      ],
    });
  });

  it('scopes the rejection lookup to the caller', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections`)
      .expect(200);

    expect(repository.findRejectedRecords).toHaveBeenCalledWith(
      JOB_ID,
      DEALER_ID,
      1,
      50,
    );
  });

  it("404s another dealer's rejections without querying them", async () => {
    // The ownership check and the row query are both dealer-scoped; this pins
    // that a non-owner never reaches the second one.
    repository.findById.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections`)
      .expect(404);

    expect(repository.findRejectedRecords).not.toHaveBeenCalled();
  });

  it('returns an empty page for a clean upload rather than 404', async () => {
    const response = await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections`)
      .expect(200);

    expect(response.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('accepts page and limit', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections?page=2&limit=20`)
      .expect(200);

    expect(repository.findRejectedRecords).toHaveBeenCalledWith(
      JOB_ID,
      DEALER_ID,
      2,
      20,
    );
  });

  it('400s a limit above the page-size cap', async () => {
    // Without the cap a file that rejected every row would return the whole
    // batch in one response.
    await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections?limit=5000`)
      .expect(400);

    expect(repository.findRejectedRecords).not.toHaveBeenCalled();
  });

  it('400s a non-numeric page', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections?page=first`)
      .expect(400);
  });

  it('400s a malformed job id before reaching the repository', async () => {
    await request(app.getHttpServer())
      .get('/jobs/not-a-uuid/rejections')
      .expect(400);

    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    authenticated = false;

    await request(app.getHttpServer())
      .get(`/jobs/${JOB_ID}/rejections`)
      .expect(403);

    expect(repository.findById).not.toHaveBeenCalled();
  });
});
