import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ApproveSelectedDto,
  MAX_APPROVE_SELECTED,
} from '../../../../src/modules/listings/dto/approve-selected.dto';

const validate = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(ApproveSelectedDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('ApproveSelectedDto', () => {
  it('accepts a list of listing ids', () => {
    expect(validate({ ids: [uuid(1), uuid(2)] })).toHaveLength(0);
  });

  it('requires ids', () => {
    expect(validate({}).map((e) => e.property)).toContain('ids');
  });

  it('rejects an empty list', () => {
    expect(validate({ ids: [] }).map((e) => e.property)).toContain('ids');
  });

  it('rejects an id that is not a UUID', () => {
    expect(validate({ ids: ['not-a-uuid'] }).map((e) => e.property)).toContain('ids');
  });

  it('rejects duplicated ids', () => {
    expect(validate({ ids: [uuid(1), uuid(1)] }).map((e) => e.property)).toContain('ids');
  });

  it('accepts exactly the maximum and rejects one more', () => {
    const atLimit = Array.from({ length: MAX_APPROVE_SELECTED }, (_, i) => uuid(i + 1));
    expect(validate({ ids: atLimit })).toHaveLength(0);
    expect(validate({ ids: [...atLimit, uuid(MAX_APPROVE_SELECTED + 1)] }).length).toBeGreaterThan(0);
  });

  it('rejects fields it does not know about', () => {
    expect(validate({ ids: [uuid(1)], dealerId: uuid(9) }).length).toBeGreaterThan(0);
  });
});
