import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthInternalClient {
  constructor(private readonly config: ConfigService) {}

  approveDealer(dealerId: string, adminId: string) {
    return this.post(`/internal/dealers/${dealerId}/approve`, { adminId });
  }

  rejectDealer(dealerId: string, adminId: string) {
    return this.post(`/internal/dealers/${dealerId}/reject`, { adminId });
  }

  deactivateUser(userId: string, adminId: string) {
    return this.post(`/internal/users/${userId}/deactivate`, { adminId });
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('AUTH_INTERNAL_URL') ??
      this.config.get<string>('AUTH_SERVICE_INTERNAL_URL') ??
      'http://localhost:3001'
    ).replace(/\/$/, '');
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${this.baseUrl()}${path}`;
    const key = this.config.getOrThrow<string>('INTERNAL_SERVICE_KEY');

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': key,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(`Auth service unreachable: ${message}`);
    }

    if (res.ok) {
      if (res.status === 204) return undefined;
      return res.json() as Promise<unknown>;
    }

    const message = await readErrorMessage(res);
    if (res.status === 400) throw new BadRequestException(message);
    if (res.status === 403) throw new ForbiddenException(message);
    if (res.status === 404) throw new NotFoundException(message);
    throw new BadGatewayException(`Auth internal call failed (${res.status}): ${message}`);
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(', ');
    if (parsed.message) return parsed.message;
  } catch {
    /* not JSON */
  }
  return text || `HTTP ${res.status}`;
}
