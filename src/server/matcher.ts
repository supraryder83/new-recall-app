import type {
  NormalizedRecall,
  WatchlistItem,
  MatchEvaluation,
  UserMatchGroup
} from '../types/pipeline';
import { cleanAlphanumeric, extractDistinctiveTokens, normalizeCleanText } from './normalizer';

export interface MatchOptions {
  fuzzyThreshold?: number; // default: 75 (0-100)
}

/**
 * Evaluates whether a single watchlist item matches a normalized recall
 * based on the 3 specification criteria:
 * 1. Exact match on UPC/barcode (highest priority)
 * 2. Normalized substring or exact match on model numbers
 * 3. Tokenized fuzzy match on brand + product keywords
 */
export function evaluateItemMatch(
  watchItem: WatchlistItem,
  recall: NormalizedRecall,
  options: MatchOptions = {}
): MatchEvaluation | null {
  // =========================================================================
  // CRITERION 1: Exact match on UPC / barcode (Highest Priority)
  // =========================================================================
  const rawUpc = (watchItem.upcBarcode || '').trim();
  const upcDigits = rawUpc.replace(/\D/g, '');

  if (upcDigits.length >= 8) {
    // Check extracted UPCs array
    const exactUpcMatch = recall.upcs.includes(upcDigits);
    // Check if the digits appear directly in the raw text or title
    const textContainsUpc = recall.searchIndexText.includes(upcDigits);

    if (exactUpcMatch || textContainsUpc) {
      return {
        watchItem,
        recall,
        matchType: 'upc',
        score: 100,
        reason: `Exact match on UPC/barcode (${upcDigits})`
      };
    }
  }

  // =========================================================================
  // CRITERION 2: Normalized substring or exact match on model numbers
  // =========================================================================
  const rawModel = (watchItem.modelNumber || '').trim();
  const normModel = cleanAlphanumeric(rawModel);

  if (normModel.length >= 3) {
    // Check exact model match in normalized modelNumbers
    const exactModelMatch = recall.modelNumbers.includes(normModel);
    if (exactModelMatch) {
      return {
        watchItem,
        recall,
        matchType: 'model',
        score: 95,
        reason: `Exact match on model number (${rawModel})`
      };
    }

    // Check substring match on model number
    // To prevent false positives on short numbers, require length >= 4 for substring or letters+numbers
    const isAlphanumericCode = /\d/.test(normModel) && /[a-z]/.test(normModel);
    if (normModel.length >= 4 || isAlphanumericCode) {
      if (recall.searchIndexText.includes(normModel)) {
        return {
          watchItem,
          recall,
          matchType: 'model',
          score: 90,
          reason: `Normalized substring match on model number (${rawModel})`
        };
      }
    }
  }

  // =========================================================================
  // CRITERION 3: Tokenized fuzzy match on brand + product keywords
  // =========================================================================
  const rawBrand = (watchItem.brand || '').trim();
  const normBrand = cleanAlphanumeric(rawBrand);
  const rawProduct = (watchItem.productName || '').trim();

  // Extract distinctive product tokens
  const productTokens = extractDistinctiveTokens(rawProduct);
  const rawKeywords = watchItem.keywords || [];
  const keywordTokens = rawKeywords
    .map((k) => cleanAlphanumeric(k))
    .filter((k) => k.length >= 3);

  // Combine unique distinctive tokens to search for
  const targetTokens = Array.from(new Set([...productTokens, ...keywordTokens]));

  // Brand evaluation
  let brandMatches = false;
  if (normBrand.length >= 2) {
    brandMatches =
      recall.normalizedBrand.includes(normBrand) ||
      normBrand.includes(recall.normalizedBrand) ||
      recall.searchIndexText.includes(normBrand);
  }

  // If user provided a specific brand but it completely fails to match the recall,
  // and we have no UPC/model, do not match products across different brands
  if (normBrand.length >= 3 && !brandMatches) {
    return null;
  }

  // Exact phrase match check (e.g., "Crispy Protein Bites" in title)
  const normProductText = normalizeCleanText(rawProduct);
  let hasExactPhraseMatch = false;
  if (normProductText.length >= 5 && recall.searchIndexText.includes(normProductText)) {
    hasExactPhraseMatch = true;
  }

  // Count token concordance
  let matchedTokensCount = 0;
  for (const token of targetTokens) {
    if (recall.searchIndexText.includes(token)) {
      matchedTokensCount++;
    }
  }

  const tokenRatio = targetTokens.length > 0 ? matchedTokensCount / targetTokens.length : 0;

  // Calculate fuzzy score
  let score = 0;
  if (brandMatches) score += 35;
  score += Math.round(tokenRatio * 50);
  if (hasExactPhraseMatch) score += 15;

  // Conditions for a valid fuzzy match:
  // Must satisfy:
  // - Brand matches (or user did not specify brand)
  // - Significant token concordance (>= 50% or >= 2 tokens)
  // - Overall score meets fuzzyThreshold (default: 70)
  const tokenConditionMet =
    targetTokens.length <= 1
      ? matchedTokensCount === 1 && (brandMatches || !normBrand)
      : tokenRatio >= 0.5 || matchedTokensCount >= 2;

  const validFuzzy =
    (brandMatches || !normBrand) &&
    (hasExactPhraseMatch || tokenConditionMet) &&
    score >= (options.fuzzyThreshold ?? 70);

  if (validFuzzy) {
    return {
      watchItem,
      recall,
      matchType: 'brand_keyword',
      score: Math.min(100, score),
      reason: `Tokenized fuzzy match on brand + product keywords (${matchedTokensCount}/${targetTokens.length} tokens matched${
        brandMatches ? ', brand confirmed' : ''
      })`
    };
  }

  return null;
}

/**
 * Runs reverse-lookup matching of the user watchlist collection against an incoming
 * batch of normalized recalls.
 * Groups matched items by user ID to avoid spamming multiple notifications for the same sync cycle.
 */
export function matchWatchlistAgainstRecalls(
  watchlist: WatchlistItem[],
  incomingRecalls: NormalizedRecall[],
  options: MatchOptions = {}
): UserMatchGroup[] {
  const userGroupMap = new Map<string, MatchEvaluation[]>();

  for (const watchItem of watchlist) {
    for (const recall of incomingRecalls) {
      const evaluation = evaluateItemMatch(watchItem, recall, options);
      if (evaluation) {
        let userMatches = userGroupMap.get(watchItem.userId);
        if (!userMatches) {
          userMatches = [];
          userGroupMap.set(watchItem.userId, userMatches);
        }

        // Avoid duplicate pair of the same watchItem and recall
        const alreadyAdded = userMatches.some(
          (m) => m.watchItem.id === watchItem.id && m.recall.recallId === recall.recallId
        );
        if (!alreadyAdded) {
          userMatches.push(evaluation);
        }
      }
    }
  }

  // Convert map to array of UserMatchGroup, sorted with highest match score first
  const result: UserMatchGroup[] = [];

  for (const [userId, matches] of userGroupMap.entries()) {
    matches.sort((a, b) => b.score - a.score);
    result.push({
      userId,
      matches
    });
  }

  return result;
}
