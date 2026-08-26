import { ROLES_KEY, Roles } from '../../../../src/modules/auth/decorators/roles.decorator';

describe('Roles decorator', () => {
  it('attaches the given roles under ROLES_KEY as reflectable metadata', () => {
    class TestController {
      @Roles('DEALER', 'ADMIN')
      handler() {}
    }

    const metadata = Reflect.getMetadata(ROLES_KEY, TestController.prototype.handler);
    expect(metadata).toEqual(['DEALER', 'ADMIN']);
  });

  it('accepts zero roles (metadata is an empty array, not undefined)', () => {
    class TestController {
      @Roles()
      handler() {}
    }

    expect(Reflect.getMetadata(ROLES_KEY, TestController.prototype.handler)).toEqual([]);
  });
});
