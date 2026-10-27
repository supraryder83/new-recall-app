import type { RecallItem } from '../types/recall';
import type { NormalizedRecall } from '../types/pipeline';

// Stopwords in English and French to avoid false positive model/brand extractions
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'for', 'with', 'by', 'to', 'at', 'from',
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'pour', 'avec', 'par',
  'recalled', 'recall', 'recalls', 'rappel', 'rappels', 'alert', 'alerte', 'safety',
  'product', 'products', 'produit', 'produits', 'item', 'items', 'brand', 'marque',
  'certain', 'certains', 'various', 'divers', 'all', 'tous', 'pack', 'pkg', 'size', 'format',
  'net', 'wt', 'weight', 'poids', 'gram', 'grams', 'ml', 'oz', 'kg', 'lb',
  'due', 'because', 'canada', 'canadian', 'canadien', 'canadienne', 'notice', 'avis',
  'number', 'code', 'lot', 'date', 'best', 'before', 'upc', 'inc', 'ltd', 'corp', 'co',
  'may', 'are', 'was', 'were', 'not', 'that', 'this', 'have', 'has', 'been', 'which',
  'contain', 'contains', 'foreign', 'pieces', 'particles', 'risk', 'hazard', 'safety'
]);

function splitCompoundWords(str: string): string {
  if (!str) return '';
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/**
 * Normalizes text to lowercase, removes accents/diacritics, and strips non-alphanumeric chars
 */
export function cleanAlphanumeric(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Normalizes text with space preservation and compound word splitting
 */
export function normalizeCleanText(str: string): string {
  return splitCompoundWords(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['"’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts distinctive tokens (length >= 3, excluding stopwords)
 */
export function extractDistinctiveTokens(text: string): string[] {
  const norm = normalizeCleanText(text);
  const rawTokens = norm.split(' ');
  const tokenSet = new Set<string>();

  for (const t of rawTokens) {
    if (t.length >= 3 && !STOPWORDS.has(t)) {
      tokenSet.add(t);
    }
  }

  return Array.from(tokenSet);
}

/**
 * Parse publication date into a consistent timestamp and YYYY-MM-DD string
 */
export function parsePublicationDate(dateStr?: string): { formatted: string; timestamp: number } {
  if (!dateStr || typeof dateStr !== 'string') {
    const now = Date.now();
    return { formatted: new Date(now).toISOString().slice(0, 10), timestamp: now };
  }

  const clean = dateStr.trim();
  // Check YYYY-MM-DD
  const ymdMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const ts = new Date(`${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}T00:00:00Z`).getTime();
    return { formatted: `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`, timestamp: isNaN(ts) ? Date.now() : ts };
  }

  const parsedTs = Date.parse(clean);
  if (!isNaN(parsedTs)) {
    return { formatted: new Date(parsedTs).toISOString().slice(0, 10), timestamp: parsedTs };
  }

  return { formatted: clean.slice(0, 10), timestamp: Date.now() };
}

/**
 * Extracts UPC / Barcodes from fields and descriptions
 */
export function extractUpcs(rawText: string): string[] {
  const upcs = new Set<string>();

  // 1. Explicit UPC patterns: "UPC: 065633458921" or "Barcode # 123456789012"
  const explicitPattern = /\b(?:upc|ean|gtin|barcode|bar\s*code)[\s:#-]*([0-9]{8,14})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = explicitPattern.exec(rawText)) !== null) {
    const code = match[1].replace(/[^0-9]/g, '');
    if (code.length >= 8 && code.length <= 14) {
      upcs.add(code);
    }
  }

  // 2. Standalone 12-digit (UPC-A) or 13-digit (EAN-13) sequences
  const standalonePattern = /\b(\d{12,13})\b/g;
  while ((match = standalonePattern.exec(rawText)) !== null) {
    const digits = match[1];
    // Exclude timestamps or repetitive numbers like 202610260000
    if (!digits.startsWith('202') && !digits.startsWith('199')) {
      upcs.add(digits);
    }
  }

  return Array.from(upcs);
}

/**
 * Extracts model numbers from fields and descriptions
 */
export function extractModelNumbers(rawText: string): string[] {
  const models = new Set<string>();

  // 1. Explicit model patterns: "Model CI1012", "Model number JK-200", "Item # 94821"
  const explicitModelPattern = /\b(?:model|item|sku|part|ref|reference)[\s#:]*([a-z0-9][a-z0-9\-_]{2,18})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = explicitModelPattern.exec(rawText)) !== null) {
    const rawVal = match[1].toLowerCase().replace(/^[\-_]+|[\-_]+$/g, '');
    if (rawVal.length >= 3 && !STOPWORDS.has(rawVal)) {
      // Must have digits or a hyphen/letter mix to avoid standard words
      if (/\d/.test(rawVal) || rawVal.includes('-')) {
        models.add(cleanAlphanumeric(rawVal));
      }
    }
  }

  // 2. Transport Canada Recall codes (e.g., "2026503", "2025541")
  const tcPattern = /\b(?:Transport\s+Canada\s+Recall\s*[-–—]?\s*|TC\s+Recall\s*[-–—]?\s*)(\d{6,8})\b/gi;
  while ((match = tcPattern.exec(rawText)) !== null) {
    models.add(cleanAlphanumeric(match[1]));
  }

  // 3. Known uppercase alphanumeric model tokens (e.g., CI1012, JKMAX100)
  const tokenModelPattern = /\b([A-Z]{1,5}\d{2,8}[A-Z0-9\-]*)\b/g;
  while ((match = tokenModelPattern.exec(rawText)) !== null) {
    const candidate = match[1].toLowerCase();
    if (candidate.length >= 3 && !STOPWORDS.has(candidate)) {
      models.add(cleanAlphanumeric(candidate));
    }
  }

  return Array.from(models);
}

/**
 * Extracts lot / batch numbers
 */
export function extractLotCodes(rawText: string): string[] {
  const lots = new Set<string>();
  const lotPattern = /\b(?:lot|batch|lots|batches)[\s#:]*([a-z0-9][a-z0-9\-_]{2,18})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = lotPattern.exec(rawText)) !== null) {
    const val = match[1].toLowerCase().replace(/^[\-_]+|[\-_]+$/g, '');
    if (val.length >= 3 && !STOPWORDS.has(val) && (/\d/.test(val) || val.includes('-'))) {
      lots.add(cleanAlphanumeric(val));
    }
  }
  return Array.from(lots);
}

/**
 * Extracts likely brand name from recall title or fields
 */
export function extractBrand(rawItem: RecallItem): { brand: string; tokens: string[] } {
  const title = rawItem.Title || '';
  const product = rawItem.Product || '';
  const organization = rawItem.Organization || '';

  let candidate = '';

  // 1. "X brand ..." (very common in CFIA & Health Canada notices)
  const brandRegex = /^([A-Za-z0-9&'\s]+?)\s+brand\b/i;
  const brandMatch = title.match(brandRegex);
  if (brandMatch && brandMatch[1].trim().length > 1) {
    candidate = brandMatch[1].trim();
  }

  // 2. "X recalls ..."
  if (!candidate) {
    const recallRegex = /^([A-Za-z0-9&'\s]+?)\s+(?:recalls|recalling|voluntarily\s+recalls)\b/i;
    const recallMatch = title.match(recallRegex);
    if (recallMatch && recallMatch[1].trim().length > 1) {
      candidate = recallMatch[1].trim();
    }
  }

  // 3. First 1-2 words of product if title starts with brand
  if (!candidate && product) {
    const parts = product.split(/\s+/);
    if (parts.length > 0 && parts[0].length >= 3) {
      candidate = parts[0];
    }
  }

  // 4. Fallback to organization if specific
  if (!candidate && organization && !['CFIA', 'Consumer product safety', 'Health Canada'].includes(organization)) {
    candidate = organization;
  }

  const normalized = cleanAlphanumeric(candidate);
  const tokens = extractDistinctiveTokens(candidate);

  return { brand: normalized, tokens };
}

/**
 * Ingests a raw Health Canada recall item and outputs a fully normalized record
 * indexed for reverse-lookup matching.
 */
export function normalizeRecall(item: RecallItem): NormalizedRecall {
  const recallId = (item.NID || '').trim();
  const title = (item.Title || '').trim();
  const category = (item.Category || '').trim();
  const url = (item.URL || '').trim();
  const organization = (item.Organization || '').trim();
  const product = (item.Product || '').trim();
  const issue = (item.Issue || '').trim();
  const whatToDo = (item['What you should do'] || '').trim();

  // Combine full text corpus for extraction
  const fullCorpus = `${title} ${product} ${issue} ${whatToDo} ${organization} ${category}`;

  // Publication date
  const { formatted: publicationDate, timestamp: publicationTimestamp } = parsePublicationDate(
    item['Last updated']
  );

  // Extract brand
  const { brand: normalizedBrand, tokens: brandTokens } = extractBrand(item);

  // Extract product tokens
  const normalizedProduct = cleanAlphanumeric(product || title);
  const productTokens = extractDistinctiveTokens(`${product} ${title}`);

  // Extract entities
  const upcs = extractUpcs(fullCorpus);
  const modelNumbers = extractModelNumbers(fullCorpus);
  const lotCodes = extractLotCodes(fullCorpus);

  // Search index text (alphanumeric lowercase words)
  const searchIndexText = normalizeCleanText(fullCorpus);

  return {
    recallId,
    title,
    category,
    publicationDate,
    publicationTimestamp,
    url,
    organization,
    rawItem: item,

    normalizedBrand,
    brandTokens,
    normalizedProduct,
    productTokens,

    upcs,
    modelNumbers,
    lotCodes,

    searchIndexText
  };
}

/**
 * Batch normalization of raw recall items
 */
export function normalizeRecallsBatch(items: RecallItem[]): NormalizedRecall[] {
  return items.map(normalizeRecall);
}
