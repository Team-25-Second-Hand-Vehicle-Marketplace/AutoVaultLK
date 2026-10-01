import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * East-west client into marketplace-service (ADR-005) - a copy of
 * AuthInternalClient's shape, since marketplace_service_role is the only
 * role with write access to marketplace.vehicle_dictionaries and
 * admin_service_role holds SELECT there only.
 */
@Injectable()
export class MarketplaceInternalClient {
  constructor(private readonly config: ConfigService) {}

  createDictionaryEntry(dictionaryType: string, canonicalValue: string) {
    return this.post('/internal/dictionary', {
      dictionaryType,
      canonicalValue,
    });
  }

  addDictionaryAlias(dictionaryId: string, alias: string) {
    return this.post(`/internal/dictionary/${dictionaryId}/aliases`, { alias });
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('MARKETPLACE_INTERNAL_URL') ??
      'http://localhost:3002'
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
      throw new BadGatewayException(
        `Marketplace service unreachable: ${message}`,
      );
    }

    if (res.ok) {
      if (res.status === 204) return undefined;
      return res.json() as Promise<unknown>;
    }

    const message = await readErrorMessage(res);
    if (res.status === 400) throw new BadRequestException(message);
    if (res.status === 403) throw new ForbiddenException(message);
    if (res.status === 404) throw new NotFoundException(message);
    if (res.status === 409) throw new ConflictException(message);
    throw new BadGatewayException(
      `Marketplace internal call failed (${res.status}): ${message}`,
    );
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
