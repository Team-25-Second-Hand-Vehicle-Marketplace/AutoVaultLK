export function parseAllowedOrigins(value?: string): string[] {
  if (!value?.trim()) {
    return ['http://localhost:5173'];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

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
