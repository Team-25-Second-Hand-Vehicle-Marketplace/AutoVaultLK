
const DEFAULT_URL = 'http://localhost:3005';

/** Matches notification-service's INTAKE_NOTIFICATION_TYPES. */
export type NotificationEventType =
  | 'UPLOAD_COMPLETED'
  | 'UPLOAD_FAILED'
  | 'DEALER_VERIFIED'
  | 'DEALER_REJECTED';

export type NotificationEvent = {
  type: NotificationEventType;
  userId: string;
  /** 8–128 chars, enforced by CreateNotificationEventDto. */
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

export type EmitOutcome =
  | { sent: true }
  | { sent: false; reason: string };

export function isNotificationConfigured(): boolean {
  return (process.env.INTERNAL_SERVICE_KEY ?? '').trim().length > 0;
}

export async function emit(event: NotificationEvent): Promise<EmitOutcome> {
  const key = (process.env.INTERNAL_SERVICE_KEY ?? '').trim();
  if (!key) return { sent: false, reason: 'INTERNAL_SERVICE_KEY is not set' };

  const base = (process.env.NOTIFICATION_INTERNAL_URL ?? DEFAULT_URL).replace(/\/$/, '');
  const timeoutMs = Number(process.env.NOTIFICATION_TIMEOUT_MS ?? 5000) || 5000;

  let response: Response;
  try {
    response = await fetch(`${base}/notifications/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': key,
      },
      body: JSON.stringify(event),
      // Without a timeout an unreachable notification service would hold the
      // NOTIFY stage open until the Lambda's own limit, long after the data
      // landed.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    return { sent: false, reason: `HTTP ${response.status}` };
  }

  return { sent: true };
}
