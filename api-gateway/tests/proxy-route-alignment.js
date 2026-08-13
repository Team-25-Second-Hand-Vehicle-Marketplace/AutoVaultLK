/**
 * Expected nginx location -> upstream path mapping for implemented services.
 * Gateway path + rewrite rule must match NestJS @Controller paths on each service.
 */
const PROXY_ROUTE_ALIGNMENT = [
  {
    name: 'auth-user-service auth routes',
    location: '/auth/',
    upstream: 'auth_user_service',
    proxyPath: '/auth/',
    preservePrefix: true,
    examples: [
      { gateway: '/auth/login', upstream: '/auth/login' },
      { gateway: '/auth/register/buyer', upstream: '/auth/register/buyer' },
    ],
    controllers: ['auth'],
  },
  {
    name: 'auth-user-service user routes',
    location: '/users/',
    upstream: 'auth_user_service',
    proxyPath: '/users/',
    preservePrefix: true,
    examples: [
      { gateway: '/users/me', upstream: '/users/me' },
      { gateway: '/users/{id}', upstream: '/users/{id}' },
    ],
    controllers: ['users'],
  },
  {
    name: 'auth-user-service dealer profile routes',
    location: '/dealer-profiles/',
    upstream: 'auth_user_service',
    proxyPath: '/dealer-profiles/',
    preservePrefix: true,
    examples: [
      { gateway: '/dealer-profiles/me', upstream: '/dealer-profiles/me' },
    ],
    controllers: ['dealer-profiles'],
  },
  {
    name: 'marketplace-service routes',
    location: '/marketplace/',
    upstream: 'marketplace_service',
    proxyPath: '/',
    preservePrefix: false,
    examples: [
      { gateway: '/marketplace/listings', upstream: '/listings' },
      { gateway: '/marketplace/dealers/{id}/profile', upstream: '/dealers/{id}/profile' },
    ],
    controllers: ['listings', 'dealers'],
  },
  {
    name: 'ingestion-service ingest routes (service stub)',
    location: '/ingest/',
    upstream: 'ingestion_service',
    proxyPath: '/ingest/',
    preservePrefix: true,
    examples: [{ gateway: '/ingest/upload', upstream: '/ingest/upload' }],
    controllers: [],
  },
  {
    name: 'ingestion-service job routes (service stub)',
    location: '/jobs/',
    upstream: 'ingestion_service',
    proxyPath: '/jobs/',
    preservePrefix: true,
    examples: [{ gateway: '/jobs/{jobId}', upstream: '/jobs/{jobId}' }],
    controllers: [],
  },
  {
    name: 'admin-service routes (service stub)',
    location: '/admin/',
    upstream: 'admin_service',
    proxyPath: '/admin/',
    preservePrefix: true,
    examples: [{ gateway: '/admin/dashboard', upstream: '/admin/dashboard' }],
    controllers: [],
  },
  {
    name: 'notification-service routes (service stub)',
    location: '/notifications/',
    upstream: 'notification_service',
    proxyPath: '/notifications/',
    preservePrefix: true,
    examples: [
      { gateway: '/notifications/{id}', upstream: '/notifications/{id}' },
    ],
    controllers: [],
  },
];

module.exports = { PROXY_ROUTE_ALIGNMENT };
