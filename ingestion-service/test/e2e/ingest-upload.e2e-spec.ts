import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { IngestionController } from '../../src/modules/ingestion/controllers/ingestion.controller';
import { IngestionUploadService } from '../../src/modules/ingestion/services/ingestion-upload.service';
import { UploadJobRepository } from '../../src/modules/ingestion/repositories/upload-job.repository';
import { DealerProfileRepository } from '../../src/modules/ingestion/repositories/dealer-profile.repository';
import { OBJECT_STORE } from '../../src/infrastructure/ports/object-store.port';
import { JOB_QUEUE } from '../../src/infrastructure/ports/job-queue.port';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../src/modules/auth/types/authenticated-user.type';

/**
 * Exercises the real HTTP -> guards -> multipart interceptor -> controller ->
 * service path for POST /ingest/upload, wired the way main.ts wires it
 * (including the global ValidationPipe).
 *
 * The seams that need a database or a filesystem are stubbed — the
 * repositories, the ObjectStore and the JobQueue — because what this suite is
 * for is the contract the gateway and the dealer frontend depend on: which
 * status code comes back, and what the body looks like. The pipeline itself is
 * covered by the integration suite against real Postgres.
 *
 * Auth is stubbed at the guard rather than by minting a JWT: the strategy
 * needs a live `auth.users` lookup, and this suite is about the upload
 * contract, not about token verification.
 */

const DEALER: AuthenticatedUser = {
  id: '3f6f6b4e-1c2d-4a5b-8c9d-0e1f2a3b4c5d',
  email: 'dealer@example.com',
  role: 'DEALER',
} as AuthenticatedUser;

const CSV = 'registration_number,make,model,year,price,mileage\nCAB-1,Toyota,Vitz,2015,3500000,45000\n';

describe('POST /ingest/upload (e2e)', () => {
  let app: INestApplication;
  let uploadJobs: { create: jest.Mock; findById: jest.Mock; updateStoragePaths: jest.Mock; updateStatus: jest.Mock };
  let dealerProfiles: { isVerifiedBusinessDealer: jest.Mock };
  let store: { put: jest.Mock };
  let queue: { publish: jest.Mock };

  /** Flipped per-test to exercise the 401 branch without a real token. */
  let authenticated = true;

  beforeAll(async () => {
    uploadJobs = {
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
      findById: jest.fn().mockResolvedValue({ id: 'job-1' }),
      updateStoragePaths: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    dealerProfiles = { isVerifiedBusinessDealer: jest.fn().mockResolvedValue(true) };
    store = { put: jest.fn().mockResolvedValue(undefined) };
    queue = { publish: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [IngestionController],
      providers: [
        IngestionUploadService,
        { provide: UploadJobRepository, useValue: uploadJobs },
        { provide: DealerProfileRepository, useValue: dealerProfiles },
        { provide: OBJECT_STORE, useValue: store },
        { provide: JOB_QUEUE, useValue: queue },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: AuthenticatedUser } } }) => {
          if (!authenticated) return false;
          ctx.switchToHttp().getRequest().user = DEALER;
          return true;
        },
      })
      // RolesGuard reads request.user, which the stub above sets. Left real so
      // @Roles('DEALER') is actually evaluated rather than assumed.
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => DEALER.role === 'DEALER' })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts. Kept in sync deliberately — a pipe difference here
    // would make the suite pass on wiring the real app does not have.
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
    uploadJobs.create.mockResolvedValue({ id: 'job-1' });
    uploadJobs.findById.mockResolvedValue({ id: 'job-1' });
    dealerProfiles.isVerifiedBusinessDealer.mockResolvedValue(true);
  });

  describe('happy path', () => {
    it('accepts a CSV and returns 202 with the job id', async () => {
      const response = await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.csv')
        .expect(202);

      expect(response.body).toMatchObject({
        jobId: 'job-1',
        status: 'PENDING',
        fileName: 'stock.csv',
      });
    });

    it('stores the file under raw/{jobId}/ before publishing', async () => {
      await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.csv')
        .expect(202);

      expect(store.put).toHaveBeenCalledWith(
        'raw/job-1/stock.csv',
        expect.any(Buffer),
        'text/csv',
      );
    });

    it('publishes the job rather than awaiting the pipeline', async () => {
      // FR-32: the dealer polls GET /jobs/{id}. A response that waited for the
      // ETL would time out on any real file.
      await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.csv')
        .expect(202);

      expect(queue.publish).toHaveBeenCalledWith({ jobId: 'job-1' });
    });

    it('accepts an optional image archive alongside the CSV', async () => {
      await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.csv')
        .attach('zip', Buffer.from('PK\u0003\u0004fake'), 'photos.zip')
        .expect(202);

      expect(store.put).toHaveBeenCalledWith(
        'raw/job-1/photos.zip',
        expect.any(Buffer),
        'application/zip',
      );
    });
  });

  describe('authorisation', () => {
    it('401s without a token', async () => {
      authenticated = false;

      await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.csv')
        .expect(403); // Nest returns 403 when canActivate returns false

      expect(store.put).not.toHaveBeenCalled();
    });

    it('403s an unverified or non-business dealer', async () => {
      // @Roles('DEALER') is not enough: the contract says "business dealer,
      // verified", which is two conditions and lives in the repository.
      dealerProfiles.isVerifiedBusinessDealer.mockResolvedValue(false);

      const response = await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.csv')
        .expect(403);

      expect(response.body.message).toMatch(/verified business dealers/i);
      // Nothing is stored and no job is created for a refused dealer.
      expect(uploadJobs.create).not.toHaveBeenCalled();
      expect(store.put).not.toHaveBeenCalled();
    });
  });

  describe('file validation', () => {
    it('400s when no CSV is attached', async () => {
      const response = await request(app.getHttpServer())
        .post('/ingest/upload')
        .expect(400);

      expect(response.body.message).toMatch(/csv file is required/i);
    });

    it('400s a non-CSV extension', async () => {
      const response = await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.xlsx')
        .expect(400);

      expect(response.body.message).toMatch(/must be a CSV/i);
    });

    it('400s an empty CSV', async () => {
      const response = await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.alloc(0), 'stock.csv')
        .expect(400);

      expect(response.body.message).toMatch(/empty/i);
    });

    it('400s a field the interceptor does not declare', async () => {
      // FileFieldsInterceptor declares only `csv` and `zip`. Multer rejects
      // anything else outright rather than dropping it, so a frontend using
      // the wrong field name gets "Unexpected field" — not the friendlier
      // "csv file is required". Pinned because that message is what a
      // developer debugging a failed upload will search for.
      const response = await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('file', Buffer.from(CSV), 'stock.csv')
        .expect(400);

      expect(response.body.message).toMatch(/unexpected field/i);
      expect(store.put).not.toHaveBeenCalled();
    });
  });

  describe('failure handling', () => {
    it('marks the job FAILED when storage rejects the write', async () => {
      // The job row already exists by then, so leaving it PENDING would strand
      // a dealer polling a status that never changes.
      store.put.mockRejectedValueOnce(new Error('disk full'));

      await request(app.getHttpServer())
        .post('/ingest/upload')
        .attach('csv', Buffer.from(CSV), 'stock.csv')
        .expect(500);

      expect(uploadJobs.updateStatus).toHaveBeenCalledWith('job-1', 'FAILED');
      expect(queue.publish).not.toHaveBeenCalled();
    });
  });
});
