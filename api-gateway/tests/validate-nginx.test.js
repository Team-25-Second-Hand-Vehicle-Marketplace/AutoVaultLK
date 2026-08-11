describe('scripts/validate-nginx', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('passes host.docker.internal mapping to docker in CI/Linux environments', () => {
    const execSync = jest.fn();

    jest.doMock('node:child_process', () => ({ execSync }));
    jest.doMock('node:fs', () => ({ existsSync: () => true }));
    jest.spyOn(console, 'log').mockImplementation(() => {});

    jest.isolateModules(() => {
      require('../scripts/validate-nginx');
    });

    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync.mock.calls[0][0]).toContain(
      '--add-host=host.docker.internal:host-gateway',
    );
  });
});
