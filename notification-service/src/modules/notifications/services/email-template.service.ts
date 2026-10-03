import { Injectable } from '@nestjs/common';
import type { IntakeNotificationType } from '../dto/create-notification-event.dto';

export type RenderedEmail = {
  subject: string;
  message: string;
};

@Injectable()
export class EmailTemplateService {
  render(
    type: IntakeNotificationType,
    recipientName: string,
    payload: Record<string, unknown>,
  ): RenderedEmail {
    const name = recipientName.trim() || 'there';

    switch (type) {
      case 'UPLOAD_COMPLETED':
        return {
          subject: 'Your AutoVault LK upload completed',
          message: [
            `Hi ${name},`,
            '',
            `Your inventory upload "${String(payload.fileName ?? 'file')}" finished successfully.`,
            payload.validRecords !== undefined
              ? `${payload.validRecords} row(s) loaded` +
                (payload.invalidRecords !== undefined
                  ? `, ${payload.invalidRecords} rejected.`
                  : '.')
              : 'Listings are now in pending review until you confirm them.',
            '',
            '- AutoVault LK',
          ].join('\n'),
        };
      case 'UPLOAD_FAILED':
        return {
          subject: 'Your AutoVault LK upload failed',
          message: [
            `Hi ${name},`,
            '',
            `Your inventory upload "${String(payload.fileName ?? 'file')}" did not complete.`,
            payload.reason ? `Reason: ${payload.reason}` : 'Please retry the upload from your dealer dashboard.',
            '',
            '- AutoVault LK',
          ].join('\n'),
        };
      case 'LISTING_EXPIRING_BATCH':
        return {
          subject: `${String(payload.count ?? 'Some')} of your AutoVault LK listings expire soon`,
          message: [
            `Hi ${name},`,
            '',
            `${String(payload.count ?? 'Some')} listing(s) from your upload will expire on ${String(payload.expiresOn ?? 'soon')}.`,
            'Renew them from your dealer dashboard to keep them visible. Renew all renews every listing in the batch at once.',
            '',
            '- AutoVault LK',
          ].join('\n'),
        };
      case 'LISTING_EXPIRING':
        return {
          subject: 'Your AutoVault LK listing expires soon',
          message: [
            `Hi ${name},`,
            '',
            `${String(payload.listingTitle ?? 'Your vehicle listing')} will expire on ${String(payload.expiresOn ?? 'soon')}.`,
            'Renew it from your dealer dashboard to keep it visible, or delete it if the vehicle has been sold.',
            '',
            '- AutoVault LK',
          ].join('\n'),
        };
      case 'DEALER_VERIFIED':
        return {
          subject: 'Your AutoVault LK dealer account is verified',
          message: [
            `Hi ${name},`,
            '',
            'An administrator has approved your dealer registration. You can now list vehicles on AutoVault LK.',
            '',
            '- AutoVault LK',
          ].join('\n'),
        };
      case 'DEALER_REJECTED':
        return {
          subject: 'Your AutoVault LK dealer registration was not approved',
          message: [
            `Hi ${name},`,
            '',
            'An administrator was unable to verify your dealer registration.',
            payload.reason ? `Reason: ${payload.reason}` : 'You may re-register with the required documents.',
            '',
            '- AutoVault LK',
          ].join('\n'),
        };
    }
  }
}
