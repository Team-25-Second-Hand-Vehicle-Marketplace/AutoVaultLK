import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthInternalClient } from './auth-internal.client';

function config(): ConfigService {
  return {
    get: (key: string) => (key === 'AUTH_INTERNAL_URL' ? 'http://auth:3001/' : undefined),
    getOrThrow: (key: string) => {
      if (key === 'INTERNAL_SERVICE_KEY') return 'internal-service-key';
      throw new Error(`Missing ${key}`);
    },
  } as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('AuthInternalClient', () => {
  const client = new AuthInternalClient(config());

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs approve with the internal service key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, { verificationStatus: 'VERIFIED' }),
    );

    await expect(client.approveDealer('dealer-1', 'admin-1')).resolves.toEqual({
      verificationStatus: 'VERIFIED',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://auth:3001/internal/dealers/dealer-1/approve',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Internal-Service-Key': 'internal-service-key' }),
      }),
    );
  });

  it('maps Auth 400/403/404 onto Nest HTTP exceptions', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(400, { message: 'already VERIFIED' }))
      .mockResolvedValueOnce(jsonResponse(403, { message: 'cannot deactivate self' }))
      .mockResolvedValueOnce(jsonResponse(404, { message: 'missing' }));

    await expect(client.approveDealer('d1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(client.deactivateUser('u1', 'a1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(client.rejectDealer('d1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps an unreachable Auth service to 502', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(client.approveDealer('d1', 'a1')).rejects.toBeInstanceOf(BadGatewayException);
  });
});
