export function parseAllowedOrigins(value?: string): string[] {
  if (!value?.trim()) {
    return ['http://localhost:5173'];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Mirrors auth-user-service's allowlist (configure-http-security.ts) instead
 * of the bare app.enableCors() this service used to run. In every deployed
 * environment this is belt-and-suspenders — API Gateway's own
 * cors_configuration already terminates CORS for all public traffic before a
 * request reaches this Lambda — but it's what actually governs CORS for
 * local dev (api-gateway/local/nginx.conf passes requests straight through)
 * and for anything that ever bypasses the gateway.
 */
export function buildCorsOptions(allowedOrigins: string[]) {
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS policy'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-CSRF-Token',
      'X-Device-Label',
      'X-Request-ID',
    ],
    exposedHeaders: ['X-Request-ID'],
  };
}
