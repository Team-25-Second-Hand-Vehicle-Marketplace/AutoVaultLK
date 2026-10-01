import { type Locator, type Page } from '@playwright/test';

export class SearchPage {
  constructor(private readonly page: Page) {}

  /**
   * Filtered search via a direct URL rather than the FilterSidebar's
   * selects: bypasses the NL parser entirely (no Groq dependency, no
   * deterministic-parser confidence/relaxation logic to depend on), and
   * keeps the journey about search *results and navigation*, which is
   * what this test exercises - filter-value coverage belongs to the
   * unit/API-level suites already covering FilterSearchDto.
   */
  async gotoWithFilters(params: Record<string, string>): Promise<void> {
    const query = new URLSearchParams(params).toString();
    await this.page.goto(`/search?${query}`);
  }

  resultLink(makeModel: string): Locator {
    return this.page.getByRole('link', { name: new RegExp(makeModel, 'i') }).first();
  }

  async firstResult(): Promise<Locator> {
    return this.page.locator('.nx-card').first();
  }
}
