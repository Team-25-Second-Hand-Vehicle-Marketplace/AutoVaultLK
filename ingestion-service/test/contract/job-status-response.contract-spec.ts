import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';


const JOB_STATUS_DTO = resolve(
  __dirname,
  '../../src/modules/job-status/dto/job-status-response.dto.ts',
);
const REJECTIONS_DTO = resolve(
  __dirname,
  '../../src/modules/job-status/dto/rejections-response.dto.ts',
);
const FRONTEND_TYPES = resolve(
  __dirname,
  '../../../web-frontend/src/api/ingestion.types.ts',
);

/**
 * Reads the field names declared directly inside a `class Name { ... }` or
 * `type Name = { ... }` block - one level deep only, so a nested class
 * (StageProgressDto used inside JobStatusResponseDto) is read separately by
 * name rather than by following the reference.
 */
function readFieldNames(source: string, blockName: string): string[] {
  const classMatch = new RegExp(
    `(?:export )?class ${blockName}\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(source);
  const typeMatch = new RegExp(
    `(?:export )?type ${blockName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(source);
  const body = (classMatch ?? typeMatch)?.[1];
  if (!body) throw new Error(`${blockName} not found`);

  // A field line starts the statement at column 0 inside the block body,
  // named with an optional /** doc comment */ or // line comment stripped,
  // and ends at the first `:` - this intentionally does not try to parse
  // the type on the right-hand side, only the field name on the left.
  const withoutComments = body
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const fieldPattern = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/gm;
  const fields: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(withoutComments))) {
    fields.push(match[1]);
  }
  return fields;
}

const present =
  existsSync(JOB_STATUS_DTO) && existsSync(REJECTIONS_DTO) && existsSync(FRONTEND_TYPES);
const describeIfPresent = present ? describe : describe.skip;

describeIfPresent('job-status response contract parity with web-frontend', () => {
  const jobStatusSource = present ? readFileSync(JOB_STATUS_DTO, 'utf8') : '';
  const rejectionsSource = present ? readFileSync(REJECTIONS_DTO, 'utf8') : '';
  const frontendSource = present ? readFileSync(FRONTEND_TYPES, 'utf8') : '';

  it('JobStatusResponseDto fields match web-frontend JobStatus', () => {
    // If this fails, GET /jobs/{id} returns a field the frontend type does
    // not declare (or vice versa) - the dealer's upload-status page is
    // reading a shape that no longer matches what the server sends.
    const backendFields = readFieldNames(jobStatusSource, 'JobStatusResponseDto').sort();
    const frontendFields = readFieldNames(frontendSource, 'JobStatus').sort();

    expect(frontendFields).toEqual(backendFields);
  });

  it('StageProgressDto fields match web-frontend StageProgress', () => {
    const backendFields = readFieldNames(jobStatusSource, 'StageProgressDto').sort();
    const frontendFields = readFieldNames(frontendSource, 'StageProgress').sort();

    expect(frontendFields).toEqual(backendFields);
  });

  it('RejectedRecordDto fields match web-frontend RejectedRecord', () => {
    const backendFields = readFieldNames(rejectionsSource, 'RejectedRecordDto').sort();
    const frontendFields = readFieldNames(frontendSource, 'RejectedRecord').sort();

    expect(frontendFields).toEqual(backendFields);
  });

  it('RejectionsResponseDto fields match web-frontend RejectionsPage', () => {
    const backendFields = readFieldNames(rejectionsSource, 'RejectionsResponseDto').sort();
    const frontendFields = readFieldNames(frontendSource, 'RejectionsPage').sort();

    expect(frontendFields).toEqual(backendFields);
  });
});
