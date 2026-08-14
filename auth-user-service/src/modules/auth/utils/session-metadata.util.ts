import type { Request } from 'express';
import { SessionMetadata } from '../types/session-metadata.type';

export function extractSessionMetadata(
  req: Request,
  deviceLabel?: string | null,
): SessionMetadata {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : req.ip;

  const headerDeviceLabel = req.headers['x-device-label'];

  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: ip ?? null,
    deviceLabel:
      deviceLabel ??
      (typeof headerDeviceLabel === 'string' ? headerDeviceLabel : null),
  };
}
