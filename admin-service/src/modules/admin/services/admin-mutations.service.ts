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

  async rejectDealer(
    dealerId: string,
    actor: AuthenticatedUser,
    ipAddress: string | null,
    reason?: string,
  ) {
    const dealer = await this.auth.rejectDealer(dealerId, actor.id, reason);
    const audit = await this.auditLogs.append({
      actorId: actor.id,
      action: 'dealer.rejected',
      entityType: 'dealer',
      entityId: dealerId,
      // The reason belongs in the audit trail as well as the email: FR-02.2
      // makes the rejecting administrator accountable for the decision, and
      // "why" is the part that cannot be reconstructed after the fact.
      changes: { verificationStatus: 'REJECTED', reason: reason ?? null },
      ipAddress,
    });
    await this.notify(dealerId, 'DEALER_REJECTED', `dealer.rejected:${dealerId}`, reason);
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

  async reactivateUser(userId: string, actor: AuthenticatedUser, ipAddress: string | null) {
    const user = await this.auth.reactivateUser(userId, actor.id);
    const audit = await this.auditLogs.append({
      actorId: actor.id,
      action: 'user.reactivated',
      entityType: 'user',
      entityId: userId,
      changes: { isActive: true },
      ipAddress,
    });
    return { user, audit };
  }

  /**
   * FR-12: administrators are provisioned by database seeding *or* by an
   * authenticated administrator. This is the second path; there is
   * deliberately no public registration route for the ADMIN role.
   */
  async createAdmin(
    input: { email: string; name: string; password: string },
    actor: AuthenticatedUser,
    ipAddress: string | null,
  ) {
    const user = await this.auth.createAdmin(input, actor.id);
    const audit = await this.auditLogs.append({
      actorId: actor.id,
      action: 'user.admin_created',
      entityType: 'user',
      // The new user's id comes back from auth; fall back to null rather than
      // inventing one if the response shape ever changes.
      entityId: (user as { id?: string } | null)?.id ?? null,
      // Never log the password, not even hashed.
      changes: { email: input.email, name: input.name, role: 'ADMIN' },
      ipAddress,
    });
    return { user, audit };
  }

  private async notify(
    userId: string,
    type: 'DEALER_VERIFIED' | 'DEALER_REJECTED',
    idempotencyKey: string,
    reason?: string,
  ) {
    try {
      await this.notifications.emit({
        type,
        userId,
        idempotencyKey,
        // Only send payload when there is something to say; the notification
        // service treats an absent payload and an empty one differently.
        payload: reason ? { reason } : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Notification after ${type} failed: ${message}`);
    }
  }
}
