import { EmailTemplateService } from '../../../src/modules/notifications/services/email-template.service';

describe('EmailTemplateService - listing expiry reminders', () => {
  const templates = new EmailTemplateService();

  it('renders one batch reminder that names the count and the expiry date', () => {
    const email = templates.render('LISTING_EXPIRING_BATCH', 'Nimal', {
      count: 1042,
      expiresOn: '2026-07-05',
    });

    expect(email.subject).toContain('1042');
    expect(email.message).toContain('1042 listing(s)');
    expect(email.message).toContain('2026-07-05');
    expect(email.message).toContain('Renew all');
  });

  it('renders a single-listing reminder with its title and expiry date', () => {
    const email = templates.render('LISTING_EXPIRING', 'Nimal', {
      listingTitle: 'Toyota Aqua 2015',
      expiresOn: '2026-07-05',
    });

    expect(email.subject).toBe('Your AutoVault LK listing expires soon');
    expect(email.message).toContain('Toyota Aqua 2015 will expire on 2026-07-05');
  });
});
