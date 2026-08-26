import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditLogsQueryDto } from '../../../../src/modules/admin/dto/audit-logs-query.dto';
import { ListUploadsQueryDto } from '../../../../src/modules/admin/dto/list-uploads-query.dto';
import { ListUsersQueryDto } from '../../../../src/modules/admin/dto/list-users-query.dto';
import { ReportsQueryDto } from '../../../../src/modules/admin/dto/reports-query.dto';

describe('admin query DTOs', () => {
  it('accepts PENDING verificationStatus and rejects unknown values', async () => {
    await expect(
      validate(plainToInstance(ListUsersQueryDto, { verificationStatus: 'PENDING' })),
    ).resolves.toHaveLength(0);
    const errors = await validate(
      plainToInstance(ListUsersQueryDto, { verificationStatus: 'LIVE' }),
    );
    expect(errors.some((e) => e.property === 'verificationStatus')).toBe(true);
  });

  it('accepts FAILED upload status', async () => {
    await expect(
      validate(plainToInstance(ListUploadsQueryDto, { status: 'FAILED' })),
    ).resolves.toHaveLength(0);
  });

  it('requires from and to as dates on reports', async () => {
    const missing = await validate(plainToInstance(ReportsQueryDto, {}));
    expect(missing.map((e) => e.property).sort()).toEqual(['from', 'to']);

    await expect(
      validate(
        plainToInstance(ReportsQueryDto, {
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-14T00:00:00.000Z',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('accepts optional audit-log filters', async () => {
    await expect(
      validate(
        plainToInstance(AuditLogsQueryDto, {
          action: 'dealer.approved',
          actorId: '11111111-1111-4111-8111-111111111111',
        }),
      ),
    ).resolves.toHaveLength(0);
  });
});
