import { Injectable } from '@nestjs/common';
import {
  DictionaryCandidatesRepository,
  type DictionaryEntrySummary,
} from '../repositories/dictionary-candidates.repository';
import { trigramSimilarity } from '../util/trigram';

/**
 * Lower than AliasPromotionService's MIN_OCCURRENCES (5, marketplace-service):
 * that threshold gates an automatic, unreviewed write into the shared
 * dictionary, so it needs a high bar. This only decides what an admin sees -
 * a human reviews every entry before anything is written - so surfacing a
 * real new make sooner is worth more than filtering one extra stray typo.
 */
const MIN_OCCURRENCES = 2;

/**
 * Below this a candidate's closest existing make is not a plausible typo of
 * it - shown as "no close match", which is itself a positive signal that the
 * text names something genuinely new rather than a mangled version of
 * something that already exists.
 */
const CLOSE_MATCH_THRESHOLD = 0.3;

export type DictionaryCandidateDto = {
  rawValue: string;
  displayValue: string;
  occurrences: number;
  dealerCount: number;
  samples: {
    make: string | null;
    model: string | null;
    description: string | null;
  }[];
  closestMatch: { id: string; canonicalValue: string; score: number } | null;
};

@Injectable()
export class DictionaryCandidatesService {
  constructor(private readonly repository: DictionaryCandidatesRepository) {}

  /**
   * Every unresolved make worth an admin's attention, each scored against
   * the existing dictionary so a mangled typo of a real make ("closest
   * match: Toyota, 62%") reads differently at a glance than something with
   * nothing close ("no close match") - the latter is the stronger signal of
   * a genuinely new vehicle type.
   */
  async listMakeCandidates(): Promise<DictionaryCandidateDto[]> {
    const [candidates, makes] = await Promise.all([
      this.repository.findCandidates(MIN_OCCURRENCES),
      this.repository.findMakes(),
    ]);

    return candidates.map((candidate) => ({
      rawValue: candidate.normalizedValue,
      displayValue: candidate.displayValue,
      occurrences: candidate.occurrences,
      dealerCount: candidate.dealerCount,
      samples: candidate.samples,
      closestMatch: this.closestMatch(candidate.displayValue, makes),
    }));
  }

  private closestMatch(
    rawValue: string,
    makes: DictionaryEntrySummary[],
  ): { id: string; canonicalValue: string; score: number } | null {
    let best: DictionaryEntrySummary | null = null;
    let bestScore = 0;

    for (const make of makes) {
      const score = trigramSimilarity(rawValue, make.canonicalValue);
      if (score > bestScore) {
        bestScore = score;
        best = make;
      }
    }

    if (!best || bestScore < CLOSE_MATCH_THRESHOLD) return null;
    return {
      id: best.id,
      canonicalValue: best.canonicalValue,
      score: bestScore,
    };
  }
}
