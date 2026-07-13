import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTAKE_NOTIFICATION_TYPES } from '../../src/modules/notifications/dto/create-notification-event.dto';


const ADMIN_CLIENT = resolve(
  __dirname,
  '../../../admin-service/src/modules/admin/clients/notification-internal.client.ts',
);
const INGESTION_CLIENT = resolve(
  __dirname,
  '../../../ingestion-service/src/workers/etl-worker/pipeline/notify/notification-client.ts',
);

/** Reads the string literal members of an `export type Name = 'A' | 'B' | ...` union. */
function readUnionMembers(source: string, typeName: string): string[] {
  const match = new RegExp(
    `export type ${typeName}\\s*=([\\s\\S]*?);`,
  ).exec(source);
  if (!match) throw new Error(`${typeName} not found`);

  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const adminPresent = existsSync(ADMIN_CLIENT);
const ingestionPresent = existsSync(INGESTION_CLIENT);
const describeIfPresent = adminPresent && ingestionPresent ? describe : describe.skip;

describeIfPresent('intake notification type parity with internal callers', () => {
  const adminSource = adminPresent ? readFileSync(ADMIN_CLIENT, 'utf8') : '';
  const ingestionSource = ingestionPresent ? readFileSync(INGESTION_CLIENT, 'utf8') : '';

  it('admin-service NotificationEventType matches INTAKE_NOTIFICATION_TYPES', () => {
    // If this fails, admin-service can construct an event notification-service
    // rejects with a 400 - an admin action (dealer verified/rejected) whose
    // notification silently never sends.
    const theirs = readUnionMembers(adminSource, 'NotificationEventType');
    expect(theirs).toEqual([...INTAKE_NOTIFICATION_TYPES]);
  });

  it('ingestion-service NotificationEventType matches INTAKE_NOTIFICATION_TYPES', () => {
    // If this fails, a completed or failed upload job's notification is
    // rejected the same way - the dealer never finds out their upload finished.
    const theirs = readUnionMembers(ingestionSource, 'NotificationEventType');
    expect(theirs).toEqual([...INTAKE_NOTIFICATION_TYPES]);
  });
});
