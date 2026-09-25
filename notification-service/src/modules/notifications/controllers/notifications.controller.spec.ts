import { NotFoundException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  const event = {
    type: 'DEALER_VERIFIED' as const,
    userId: '5b132c13-c433-4066-9c90-a6307c61fe47',
    idempotencyKey: 'dealer.verified:5b132c13-c433-4066-9c90-a6307c61fe47',
  };

  describe('with a queue configured', () => {
    it('publishes notification events to SQS and returns an enqueue acknowledgement', async () => {
      const publisher = {
        isConfigured: jest.fn().mockReturnValue(true),
        publish: jest.fn().mockResolvedValue(undefined),
      };
      const handler = { handle: jest.fn() };
      const controller = new NotificationsController(publisher as never, handler as never);

      await expect(controller.createEvent(event)).resolves.toEqual({
        queued: true,
        idempotencyKey: event.idempotencyKey,
      });
      expect(publisher.publish).toHaveBeenCalledWith(event);
      expect(handler.handle).not.toHaveBeenCalled();
    });
  });

  describe('with no queue configured (synchronous delivery)', () => {
    const publisher = {
      isConfigured: jest.fn().mockReturnValue(false),
      publish: jest.fn(),
    };

    beforeEach(() => jest.clearAllMocks());

    it('delivers through the event handler instead of publishing', async () => {
      const handler = { handle: jest.fn().mockResolvedValue({ status: 'SENT' }) };
      const controller = new NotificationsController(publisher as never, handler as never);

      await expect(controller.createEvent(event)).resolves.toEqual({
        queued: false,
        status: 'SENT',
        idempotencyKey: event.idempotencyKey,
      });
      expect(handler.handle).toHaveBeenCalledWith(event);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('reports PENDING (retry scheduled) rather than failing on a transient send error', async () => {
      const handler = { handle: jest.fn().mockResolvedValue({ status: 'PENDING' }) };
      const controller = new NotificationsController(publisher as never, handler as never);

      await expect(controller.createEvent(event)).resolves.toMatchObject({
        queued: false,
        status: 'PENDING',
      });
    });

    it('propagates an unknown recipient as an error', async () => {
      const handler = {
        handle: jest.fn().mockRejectedValue(new NotFoundException('Recipient not found')),
      };
      const controller = new NotificationsController(publisher as never, handler as never);

      await expect(controller.createEvent(event)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
