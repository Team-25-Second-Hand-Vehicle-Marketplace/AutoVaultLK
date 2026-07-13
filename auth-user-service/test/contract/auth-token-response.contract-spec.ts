import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';


const AUTH_SERVICE = resolve(__dirname, '../../src/modules/auth/services/auth.service.ts');
const JWT_CONFIG = resolve(__dirname, '../../src/modules/auth/config/jwt.config.ts');
const FRONTEND_TYPES = resolve(__dirname, '../../../web-frontend/src/api/auth.types.ts');

/**
 * Reads the field names declared by a type alias, in either of two forms:
 * an object literal (`type Name = { ... }`/`interface Name { ... }`), or a
 * `Pick<Source, 'a' | 'b' | ...>` - AuthUser is declared the second way, so
 * its "fields" are the picked keys rather than a brace-delimited body.
 */
function readFieldNames(source: string, blockName: string): string[] {
  const pickMatch = new RegExp(
    `export type ${blockName}\\s*=\\s*Pick<[^,]+,\\s*([^>]+)>;`,
  ).exec(source);
  if (pickMatch) {
    return [...pickMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  const typeMatch = new RegExp(
    `export type ${blockName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`,
  ).exec(source);
  const interfaceMatch = new RegExp(
    `export interface ${blockName}\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(source);
  const body = (typeMatch ?? interfaceMatch)?.[1];
  if (!body) throw new Error(`${blockName} not found`);

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
  existsSync(AUTH_SERVICE) && existsSync(JWT_CONFIG) && existsSync(FRONTEND_TYPES);
const describeIfPresent = present ? describe : describe.skip;

describeIfPresent('auth token response contract parity with web-frontend', () => {
  const serviceSource = present ? readFileSync(AUTH_SERVICE, 'utf8') : '';
  const jwtConfigSource = present ? readFileSync(JWT_CONFIG, 'utf8') : '';
  const frontendSource = present ? readFileSync(FRONTEND_TYPES, 'utf8') : '';

  it('AuthTokenResponse fields match', () => {
    // If this fails, POST /auth/login or /auth/register returns a shape the
    // frontend's isTokenResponse/AuthTokenResponse handling does not expect.
    const backend = readFieldNames(serviceSource, 'AuthTokenResponse').sort();
    const frontend = readFieldNames(frontendSource, 'AuthTokenResponse').sort();
    expect(frontend).toEqual(backend);
  });

  it('AuthUser fields match', () => {
    const backend = readFieldNames(serviceSource, 'AuthUser').sort();
    const frontend = readFieldNames(frontendSource, 'AuthUser').sort();
    expect(frontend).toEqual(backend);
  });

  it('AccessTokenPayload fields match, aside from iat/exp added by JWT signing', () => {
    // The frontend additionally declares iat/exp because jsonwebtoken adds
    // them at sign time - they are never present in the type this service
    // hands to JwtService.sign, so they are excluded here rather than
    // asserted, to keep the comparison honest about what each side actually
    // authors versus what the library adds.
    const backend = readFieldNames(jwtConfigSource, 'AccessTokenPayload').sort();
    const frontend = readFieldNames(frontendSource, 'AccessTokenPayload')
      .filter((field) => field !== 'iat' && field !== 'exp')
      .sort();
    expect(frontend).toEqual(backend);
  });
});
