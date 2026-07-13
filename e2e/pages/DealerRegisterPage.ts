import { expect, type Page } from '@playwright/test';

/** A 4-step wizard: Company Info -> Contact Details -> Account Setup -> Review. */
export class DealerRegisterPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/dealer/register');
  }

  /**
   * Individual dealer path - no file upload, so it's deterministic without
   * a fixture file. The dealerType radio is checked FIRST: the NIC field
   * only renders once dealerType === 'individual' (it defaults to
   * 'business', which renders a file input in NIC's place instead).
   */
  async fillCompanyInfoIndividual(values: {
    companyName: string;
    businessAddress: string;
    city: string;
    nicNumber: string;
  }): Promise<void> {
    await this.page.getByRole('radio', { name: /individual/i }).check();
    await this.page.getByLabel('Company Name *').fill(values.companyName);
    await this.page.getByLabel('Business Address *').fill(values.businessAddress);
    await this.page.getByLabel('City *').fill(values.city);
    await this.page.getByLabel('NIC Number *').fill(values.nicNumber);
  }

  async fillCompanyInfoBusiness(values: {
    companyName: string;
    businessRegistrationNumber: string;
    businessAddress: string;
    city: string;
    documentPath: string;
  }): Promise<void> {
    await this.page.getByLabel('Company Name *').fill(values.companyName);
    await this.page
      .getByLabel('Business Registration Number *')
      .fill(values.businessRegistrationNumber);
    await this.page.getByLabel('Business Address *').fill(values.businessAddress);
    await this.page.getByLabel('City *').fill(values.city);

    await this.page.locator('input[type="file"]').setInputFiles(values.documentPath);
    await expect(this.page.getByText(/^Uploaded:/)).toBeVisible();
  }

  async fillContactDetails(values: { name: string; contactNumber: string }): Promise<void> {
    await this.page.getByLabel('Contact Name *').fill(values.name);
    // Country code select defaults to +94; left as-is deliberately.
    await this.page.getByPlaceholder('e.g. 701234567').fill(values.contactNumber);
  }

  async fillAccountSetup(values: { email: string; password: string }): Promise<void> {
    await this.page.getByLabel('Email Address *').fill(values.email);
    await this.page.getByLabel('Password *', { exact: true }).fill(values.password);
    await this.page.getByLabel('Confirm Password *').fill(values.password);
  }

  async continueStep(expectHeading: string | RegExp): Promise<void> {
    const continueButton = this.page.locator('.wizard-card__actions button', {
      hasText: 'Continue',
    });
    await expect(continueButton).toBeVisible();
    await continueButton.dispatchEvent('click');
    await expect(this.page.locator('h1')).toHaveText(expectHeading);
  }

  async submit(): Promise<void> {
    await this.page.getByRole('button', { name: /create dealer account/i }).click();
  }

  async expectVerificationNotice(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Almost there' })).toBeVisible();
  }
}
