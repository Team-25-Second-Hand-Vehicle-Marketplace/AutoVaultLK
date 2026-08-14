import { BadRequestException, Logger } from '@nestjs/common';
import { AdminMutationsService } from './admin-mutations.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

const actor: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@test.com',
  role: 'ADMIN',
};

describe('AdminMutationsService', () => {
  function makeService() {
    const auth = {
      approveDealer: jest.fn(),
      rejectDealer: jest.fn(),
      deactivateUser: jest.fn(),
    };
    const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    const auditLogs = { append: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    const service = new AdminMutationsService(
      auth as never,
      notifications as never,
      auditLogs as never,
    );
    return { service, auth, notifications, auditLogs };
  }

  it('writes audit_logs after Auth approve succeeds', async () => {
    const { service, auth, auditLogs, notifications } = makeService();
    auth.approveDealer.mockResolvedValue({ userId: 'dealer-1', verificationStatus: 'VERIFIED' });

    const result = await service.approveDealer('dealer-1', actor, '127.0.0.1');

    expect(auth.approveDealer).toHaveBeenCalledWith('dealer-1', actor.id);
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dealer.approved',
        entityId: 'dealer-1',
        actorId: actor.id,
        ipAddress: '127.0.0.1',
      }),
    );
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DEALER_VERIFIED', userId: 'dealer-1' }),
    );
    expect(result.audit).toEqual({ id: 'audit-1' });
  });

  it('does not write audit_logs when Auth rejects the call', async () => {
    const { service, auth, auditLogs, notifications } = makeService();
    auth.approveDealer.mockRejectedValue(new BadRequestException('already VERIFIED'));

    await expect(service.approveDealer('dealer-1', actor, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(auditLogs.append).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('writes user.deactivated after Auth deactivate succeeds', async () => {
    const { service, auth, auditLogs } = makeService();
    auth.deactivateUser.mockResolvedValue({ id: 'user-1', isActive: false });

    await service.deactivateUser('user-1', actor, null);

    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deactivated', entityId: 'user-1' }),
    );
  });

  it('writes dealer.rejected and emits DEALER_REJECTED after Auth reject succeeds', async () => {
    const { service, auth, auditLogs, notifications } = makeService();
    auth.rejectDealer.mockResolvedValue({ userId: 'dealer-1', verificationStatus: 'REJECTED' });

    await service.rejectDealer('dealer-1', actor, null);

    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dealer.rejected', entityId: 'dealer-1' }),
    );
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DEALER_REJECTED', userId: 'dealer-1' }),
    );
  });

  it('still returns after Auth success if notification emit fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, auth, auditLogs, notifications } = makeService();
    auth.approveDealer.mockResolvedValue({ userId: 'dealer-1', verificationStatus: 'VERIFIED' });
    notifications.emit.mockRejectedValue(new Error('notification down'));

    await expect(service.approveDealer('dealer-1', actor, null)).resolves.toMatchObject({
      audit: { id: 'audit-1' },
    });
    expect(auditLogs.append).toHaveBeenCalled();
  });
});
