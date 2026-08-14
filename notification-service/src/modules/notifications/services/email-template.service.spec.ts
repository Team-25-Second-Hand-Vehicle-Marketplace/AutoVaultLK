import { EmailTemplateService } from './email-template.service';

describe('EmailTemplateService', () => {
  const templates = new EmailTemplateService();

  it('renders an upload-completed summary', () => {
    const mail = templates.render(
      'UPLOAD_COMPLETED',
      'Amal',
      { fileName: 'stock.csv', validRecords: 40, invalidRecords: 2 },
    );
    expect(mail.subject).toMatch(/completed/i);
    expect(mail.message).toContain('Amal');
    expect(mail.message).toContain('stock.csv');
    expect(mail.message).toContain('40');
  });

  it('renders dealer verified / rejected copy', () => {
    expect(templates.render('DEALER_VERIFIED', 'Nimal', {}).subject).toMatch(/verified/i);
    expect(templates.render('DEALER_REJECTED', 'Nimal', { reason: 'documents' }).message).toContain(
      'documents',
    );
  });
});
