import { AuthController } from '../../src/modules/auth/controllers/auth.controller';

describe('AuthController', () => {
  const authService = {
    registerBuyer: jest.fn(),
    registerDealer: jest.fn(),
    login: jest.fn(),
    loginAdmin: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };
  const controller = new AuthController(authService as never);

  beforeEach(() => jest.clearAllMocks());

  it('routes buyer registration to the buyer flow', async () => {
    const data = { email: 'buyer@test.com', password: 'secret', name: 'Buyer' };
    authService.registerBuyer.mockResolvedValue({ user: { role: 'BUYER' } });

    await expect(controller.registerBuyer(data)).resolves.toEqual({
      user: { role: 'BUYER' },
    });
    expect(authService.registerBuyer).toHaveBeenCalledWith(data);
  });

  it('routes dealer registration to the dealer flow', async () => {
    const data = { email: 'dealer@test.com', password: 'secret' };
    authService.registerDealer.mockResolvedValue({ user: { role: 'DEALER' } });

    await expect(controller.registerDealer(data)).resolves.toEqual({
      user: { role: 'DEALER' },
    });
    expect(authService.registerDealer).toHaveBeenCalledWith(data);
  });

  it('routes admin login separately', async () => {
    const data = { email: 'admin@test.com', password: 'secret' };
    authService.loginAdmin.mockResolvedValue({ accessToken: 'admin-token' });

    await expect(controller.loginAdmin(data)).resolves.toEqual({
      accessToken: 'admin-token',
    });
    expect(authService.loginAdmin).toHaveBeenCalledWith(data);
  });
});
