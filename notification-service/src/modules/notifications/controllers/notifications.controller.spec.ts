import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  const event = {
    type: 'DEALER_VERIFIED' as const,
    userId: '5b132c13-c433-4066-9c90-a6307c61fe47',
    idempotencyKey: 'dealer.verified:5b132c13-c433-4066-9c90-a6307c61fe47',
  };

  it('publishes notification events to SQS and returns an enqueue acknowledgement', async () => {
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const controller = new NotificationsController(publisher as never);

    await expect(controller.createEvent(event)).resolves.toEqual({
      queued: true,
    });
    expect(publisher.publish).toHaveBeenCalledWith(event);
  });
});
