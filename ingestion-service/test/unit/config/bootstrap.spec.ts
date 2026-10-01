import { NestFactory } from '@nestjs/core';

const useMock = jest.fn();
const enableCorsMock = jest.fn();
const useGlobalFiltersMock = jest.fn();
const useGlobalPipesMock = jest.fn();
const listenMock = jest.fn().mockResolvedValue(undefined);
const getMock = jest.fn().mockReturnValue({ get: jest.fn() });

const appMock = {
  use: useMock,
  enableCors: enableCorsMock,
  useGlobalFilters: useGlobalFiltersMock,
  useGlobalPipes: useGlobalPipesMock,
  listen: listenMock,
  get: getMock,
};

jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn() },
}));

/**
 * Cheap insurance against a future main.ts edit silently dropping the
 * security middleware - this service used to run a bare app.enableCors()
 * with no Helmet at all, and nothing would have caught that regressing back.
 */
describe('bootstrap', () => {
  it('registers Helmet and an origin-allowlist CORS policy', async () => {
    (NestFactory.create as jest.Mock).mockResolvedValue(appMock);

    // require(), not a dynamic import(): these services compile under
    // node16/nodenext module resolution, so a literal import() stays a real
    // ESM import at runtime, which Jest's CJS test runner can't execute
    // without --experimental-vm-modules. require() is what Jest itself runs
    // on regardless of tsconfig's module setting.
    require('../../../src/main');
    // bootstrap() is fire-and-forget at module load; flush its microtask
    // chain (NestFactory.create -> ... -> app.listen) before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(useMock).toHaveBeenCalledTimes(1); // app.use(helmet(...))
    expect(useMock.mock.calls[0][0]).toBeInstanceOf(Function);

    expect(enableCorsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: true,
        origin: expect.any(Function),
      }),
    );
  });
});
