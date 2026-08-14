import { Injectable, Logger } from '@nestjs/common';
import type { ParsedQuery, ParserVocabulary } from '../parser/types';
import { GroqClient, parseGroqJson } from './groq-client';
import { GROQ_SYSTEM_PROMPT, buildGroqUserPayload } from './groq-prompt';
import { mergeFilters, whitelistGroqOutput } from './groq-whitelist';

export type GroqRepairResult = {
  parsed: ParsedQuery;
  usedLlm: boolean;
  dropped: string[];
};

/**
 * FR-21.2 / SAD 3.6.2: Groq only when the rules parser is below 0.6.
 * Any failure (no key, timeout, malformed JSON) returns the rules result.
 */
@Injectable()
export class GroqFallbackService {
  private readonly logger = new Logger(GroqFallbackService.name);

  constructor(private readonly groq: GroqClient) {}

  async repair(
    query: string,
    parsed: ParsedQuery,
    vocab: ParserVocabulary,
  ): Promise<GroqRepairResult> {
    if (!parsed.needsGroqFallback) {
      return { parsed, usedLlm: false, dropped: [] };
    }
    if (!this.groq.isConfigured()) {
      this.logger.warn('Groq skipped: GROQ_API_KEY is not set; using rules-only filters');
      return { parsed, usedLlm: false, dropped: [] };
    }

    try {
      const content = await this.groq.complete(
        GROQ_SYSTEM_PROMPT,
        buildGroqUserPayload(query, parsed.filters, parsed.unresolvedTokens, vocab),
      );
      const whitelisted = whitelistGroqOutput(
        parseGroqJson(content),
        vocab,
        parsed.unresolvedTokens,
      );
      if (whitelisted.dropped.length > 0) {
        this.logger.warn(`Groq whitelist dropped: ${whitelisted.dropped.join(', ')}`);
      }

      const filters = mergeFilters(parsed.filters, whitelisted.filters);
      const consumed = new Set(whitelisted.consumedTokens.map((t) => t.toLowerCase()));
      const unresolvedTokens = parsed.unresolvedTokens.filter((t) => !consumed.has(t.toLowerCase()));

      return {
        usedLlm: true,
        dropped: whitelisted.dropped,
        parsed: {
          ...parsed,
          filters,
          unresolvedTokens,
          semanticText: unresolvedTokens.join(' '),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Groq unavailable (${message}); proceeding with rules-only filters`);
      return { parsed, usedLlm: false, dropped: [] };
    }
  }
}
