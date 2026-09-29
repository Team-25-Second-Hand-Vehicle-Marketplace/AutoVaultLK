import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Drift guard between DashboardDto (dashboard.mapper.ts) and web-frontend's
 * AdminDashboard type (admin.types.ts). The two build independently, so the
 * frontend has no import path into this service's mapper — a field added,
 * renamed or removed on either side has nothing else to fail until the admin
 * dashboard silently renders undefined for a real number.
 *
 * Compares field names one level deep, per top-level section
 * (listings/users/uploads/notifications/audit) rather than the full nested
 * shape in one pass: the extraction regex captures the key before the first
 * `:` inside a brace block, so a nested object's own keys need their own
 * call rather than being picked up by the outer one.
 */

const MAPPER = resolve(__dirname, '../../src/modules/admin/mappers/dashboard.mapper.ts');
const FRONTEND_TYPES = resolve(__dirname, '../../../web-frontend/src/api/admin.types.ts');

/** Reads the top-level field names of a named `{...}` block, or a nested block reached by `path`. */
function readFieldNames(source: string, blockName: string, path: string[] = []): string[] {
  const typeMatch = new RegExp(
    `(?:export )?type ${blockName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`,
  ).exec(source);
  const interfaceMatch = new RegExp(
    `(?:export )?interface ${blockName}\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(source);
  let body = (typeMatch ?? interfaceMatch)?.[1];
  if (!body) throw new Error(`${blockName} not found`);

  for (const segment of path) {
    const nested = new RegExp(`${segment}\\s*:\\s*\\{([\\s\\S]*?)\\}`).exec(body);
    if (!nested) throw new Error(`${segment} not found inside ${blockName}`);
    body = nested[1];
  }

  const withoutComments = body
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // Stops at the field's own opening brace when its value is itself an
  // object literal, so a nested block's keys are not captured twice.
  const fieldPattern = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:\s*(\{|[^\n]+)/gm;
  const fields: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(withoutComments))) {
    fields.push(match[1]);
  }
  return fields;
}

const present = existsSync(MAPPER) && existsSync(FRONTEND_TYPES);
const describeIfPresent = present ? describe : describe.skip;

describeIfPresent('dashboard response contract parity with web-frontend', () => {
  const mapperSource = present ? readFileSync(MAPPER, 'utf8') : '';
  const frontendSource = present ? readFileSync(FRONTEND_TYPES, 'utf8') : '';

  it('top-level sections match', () => {
    const backend = readFieldNames(mapperSource, 'DashboardDto').sort();
    const frontend = readFieldNames(frontendSource, 'AdminDashboard').sort();
    expect(frontend).toEqual(backend);
  });

  it.each([
    ['listings'],
    ['users'],
    ['uploads'],
    ['notifications'],
    ['audit'],
  ])('%s section fields match', (section) => {
    const backend = readFieldNames(mapperSource, 'DashboardDto', [section]).sort();
    const frontend = readFieldNames(frontendSource, 'AdminDashboard', [section]).sort();
    expect(frontend).toEqual(backend);
  });
});
