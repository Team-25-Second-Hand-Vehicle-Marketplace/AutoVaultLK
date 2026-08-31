import { Injectable, Logger } from '@nestjs/common';

import { trigramSimilarity } from '../parser/trigram';
import {
  AliasCandidate,
  AliasPromotionRepository,
  DictionaryEntry,
} from '../repositories/alias-promotion.repository';

const MIN_OCCURRENCES = 5;
const MIN_SIMILARITY = 0.6;
const MIN_SCORE_GAP = 0.05;

@Injectable()
export class AliasPromotionService {
  private readonly logger = new Logger(AliasPromotionService.name);

  constructor(private readonly repository: AliasPromotionRepository) {}

  /**
   * Find frequently unresolved search terms and promote
   * safe matches into the vehicle dictionary.
   */
  async promoteAliases(): Promise<{
    candidates: number;
    promoted: number;
    skipped: number;
  }> {
    const candidates =
      await this.repository.findAliasCandidates(MIN_OCCURRENCES);

    const dictionaryEntries = await this.repository.findDictionaryEntries();

    let promoted = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const bestMatch = this.findBestMatch(candidate, dictionaryEntries);

      if (!bestMatch) {
        skipped++;

        this.logger.debug(
          `No safe canonical match found for "${candidate.token}"`,
        );

        continue;
      }

      const wasPromoted = await this.repository.addAlias(
        bestMatch.entry.id,
        candidate.token,
      );

      if (wasPromoted) {
        promoted++;

        this.logger.log(
          `Promoted alias "${candidate.token}" → ` +
            `"${bestMatch.entry.canonicalValue}" ` +
            `(similarity=${bestMatch.score.toFixed(3)}, ` +
            `occurrences=${candidate.occurrences})`,
        );
      } else {
        skipped++;
      }
    }

    return {
      candidates: candidates.length,
      promoted,
      skipped,
    };
  }

  /**
   * Find the strongest unambiguous canonical dictionary value
   * for an unresolved token.
   */
  private findBestMatch(
    candidate: AliasCandidate,
    entries: DictionaryEntry[],
  ): {
    entry: DictionaryEntry;
    score: number;
  } | null {
    const token = this.normalize(candidate.token);

    if (!token || token.length < 4) {
      return null;
    }

    // Don't promote a term that is already a canonical value or alias.
    for (const entry of entries) {
      if (
        this.normalize(entry.canonicalValue) === token ||
        entry.aliases.some((alias) => this.normalize(alias) === token)
      ) {
        return null;
      }
    }

    let bestEntry: DictionaryEntry | null = null;
    let bestScore = 0;
    let secondBestScore = 0;

    for (const entry of entries) {
      const score = trigramSimilarity(
        token,
        this.normalize(entry.canonicalValue),
      );

      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestEntry = entry;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    this.logger.debug(
      `Alias candidate="${token}", best="${bestEntry?.canonicalValue}", ` +
        `bestScore=${bestScore.toFixed(3)}, ` +
        `secondBestScore=${secondBestScore.toFixed(3)}`,
    );

    if (!bestEntry) {
      return null;
    }

    if (bestScore < MIN_SIMILARITY) {
      return null;
    }

    // The best match must be clearly better than the next best option.
    if (bestScore - secondBestScore < MIN_SCORE_GAP) {
      return null;
    }

    return {
      entry: bestEntry,
      score: bestScore,
    };
  }

  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ');
  }
}
