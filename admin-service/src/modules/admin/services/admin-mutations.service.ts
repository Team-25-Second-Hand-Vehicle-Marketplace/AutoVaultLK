import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { AuthInternalClient } from '../clients/auth-internal.client';
import { NotificationInternalClient } from '../clients/notification-internal.client';
import { AuditLogsRepository } from '../repositories/audit-logs.repository';

@Injectable()
export class AdminMutationsService {
  private readonly logger = new Logger(AdminMutationsService.name);

  constructor(
    private readonly auth: AuthInternalClient,
    private readonly notifications: NotificationInternalClient,
    private readonly auditLogs: AuditLogsRepository,
  ) {}

  async approveDealer(dealerId: string, actor: AuthenticatedUser, ipAddress: string | null) {
    const dealer = await this.auth.approveDealer(dealerId, actor.id);
    const audit = await this.auditLogs.append({
      actorId: actor.id,
      action: 'dealer.approved',
      entityType: 'dealer',
      entityId: dealerId,
      changes: { verificationStatus: 'VERIFIED' },
      ipAddress,
    });
    await this.notify(dealerId, 'DEALER_VERIFIED', `dealer.verified:${dealerId}`);
    return { dealer, audit };
  }

  async rejectDealer(dealerId: string, actor: AuthenticatedUser, ipAddress: string | null) {
    const dealer = await this.auth.rejectDealer(dealerId, actor.id);
    const audit = await this.auditLogs.append({
      actorId: actor.id,
      action: 'dealer.rejected',
      entityType: 'dealer',
      entityId: dealerId,
      changes: { verificationStatus: 'REJECTED' },
      ipAddress,
    });
    await this.notify(dealerId, 'DEALER_REJECTED', `dealer.rejected:${dealerId}`);
    return { dealer, audit };
  }

  async deactivateUser(userId: string, actor: AuthenticatedUser, ipAddress: string | null) {
    const user = await this.auth.deactivateUser(userId, actor.id);
    const audit = await this.auditLogs.append({
      actorId: actor.id,
      action: 'user.deactivated',
      entityType: 'user',
      entityId: userId,
      changes: { isActive: false },
      ipAddress,
    });
    return { user, audit };
  }

  private async notify(
    userId: string,
    type: 'DEALER_VERIFIED' | 'DEALER_REJECTED',
    idempotencyKey: string,
  ) {
    try {
      await this.notifications.emit({ type, userId, idempotencyKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Notification after ${type} failed: ${message}`);
    }
  }
}
