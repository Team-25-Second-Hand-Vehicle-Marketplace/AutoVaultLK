import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { SqsPublisher } from './sqs.publisher';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('SqsPublisher', () => {
  const event = {
    type: 'DEALER_REJECTED' as const,
    userId: '5b132c13-c433-4066-9c90-a6307c61fe47',
    idempotencyKey: 'dealer.rejected:5b132c13-c433-4066-9c90-a6307c61fe47',
    payload: { reason: 'Registration number unreadable' },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes the notification event as the SQS message body', async () => {
    const send = jest
      .spyOn(SQSClient.prototype, 'send')
      .mockResolvedValue({} as never);
    const publisher = new SqsPublisher(
      config({
        AWS_REGION: 'ap-southeast-1',
        AWS_ENDPOINT_URL: 'http://localhost:4566',
        NOTIFICATION_SQS_QUEUE_URL: 'https://sqs.test/notification-events',
      }),
    );

    await publisher.publish(event);

    expect(send).toHaveBeenCalledWith(expect.any(SendMessageCommand));
    const command = send.mock.calls[0][0] as SendMessageCommand;
    expect(command.input).toEqual({
      QueueUrl: 'https://sqs.test/notification-events',
      MessageBody: JSON.stringify(event),
    });
  });

  it('reports the queue as unavailable when it is not configured', async () => {
    const publisher = new SqsPublisher(
      config({ AWS_REGION: 'ap-southeast-1' }),
    );

    await expect(publisher.publish(event)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
