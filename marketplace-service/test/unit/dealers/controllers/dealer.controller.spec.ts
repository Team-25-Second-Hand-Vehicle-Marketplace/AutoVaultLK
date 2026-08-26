import { DealerController } from '../../../../src/modules/dealers/controllers/dealer.controller';

describe('DealerController', () => {
  const dealerService = {
    getProfile: jest.fn(),
    getDealerById: jest.fn(),
    updateProfile: jest.fn(),
  };
  const controller = new DealerController(dealerService as never);

  beforeEach(() => jest.clearAllMocks());

  it('GET :id/profile delegates to DealerService.getProfile', () => {
    dealerService.getProfile.mockReturnValue('profile-result');

    expect(controller.getProfile('dealer-1')).toBe('profile-result');
    expect(dealerService.getProfile).toHaveBeenCalledWith('dealer-1');
  });

  it('GET :id delegates to DealerService.getDealerById', () => {
    dealerService.getDealerById.mockReturnValue('dealer-result');

    expect(controller.getDealerById('dealer-1')).toBe('dealer-result');
    expect(dealerService.getDealerById).toHaveBeenCalledWith('dealer-1');
  });

  it('PUT :id/profile delegates to DealerService.updateProfile with id and dto', () => {
    const dto = { businessName: 'New Name' };
    dealerService.updateProfile.mockReturnValue('update-result');

    expect(controller.updateProfile('dealer-1', dto as never)).toBe('update-result');
    expect(dealerService.updateProfile).toHaveBeenCalledWith('dealer-1', dto);
  });
});
