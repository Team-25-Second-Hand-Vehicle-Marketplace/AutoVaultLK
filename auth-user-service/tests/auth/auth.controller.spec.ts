import { AuthController } from '../../src/modules/auth/controllers/auth.controller';

describe('AuthController', () => {
  const authService = {
    registerBuyer: jest.fn(),
    registerDealer: jest.fn(),
    login: jest.fn(),
    loginAdmin: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    logoutAllSessions: jest.fn(),
    requestPasswordReset: jest.fn(),
    confirmPasswordReset: jest.fn(),
    changePassword: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerificationEmail: jest.fn(),
  };
  const refreshTokenCookieService = {
    attachCookies: jest.fn((_res, payload) => payload),
    extractRefreshToken: jest.fn(),
    clearAuthCookies: jest.fn(),
  };
  const controller = new AuthController(
    authService as never,
    refreshTokenCookieService as never,
  );
  const req = {
    headers: {},
    ip: '127.0.0.1',
  } as never;

  beforeEach(() => jest.clearAllMocks());

  it('routes buyer registration to the buyer flow', async () => {
    const data = { email: 'buyer@test.com', password: 'secret', name: 'Buyer' };
    authService.registerBuyer.mockResolvedValue({ user: { role: 'BUYER' } });

    await expect(controller.registerBuyer(data, req)).resolves.toEqual({
      user: { role: 'BUYER' },
    });
    expect(authService.registerBuyer).toHaveBeenCalledWith(
      data,
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
  });

  it('routes dealer registration to the dealer flow', async () => {
    const data = { email: 'dealer@test.com', password: 'secret' };
    const pending = {
      message:
        'Registration submitted. Your account is pending administrator approval.',
      user: { id: 'uuid', role: 'DEALER', isActive: false },
      verificationStatus: 'PENDING',
    };
    authService.registerDealer.mockResolvedValue(pending);

    await expect(controller.registerDealer(data, req)).resolves.toEqual(pending);
    expect(authService.registerDealer).toHaveBeenCalledWith(
      data,
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
  });

  it('routes admin login separately', async () => {
    const data = { email: 'admin@test.com', password: 'secret' };
    authService.loginAdmin.mockResolvedValue({ accessToken: 'admin-token' });

    await expect(controller.loginAdmin(data, req, {} as never)).resolves.toEqual({
      accessToken: 'admin-token',
    });
    expect(authService.loginAdmin).toHaveBeenCalledWith(
      data,
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
    expect(refreshTokenCookieService.attachCookies).toHaveBeenCalled();
  });
});
