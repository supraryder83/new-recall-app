import { GoogleGenAI } from '@google/genai';
import type { GeminiExtractionResult, RecallItem, ScanMatchResult } from '../types/recall';
import { findRecallsByCodeOrQuery } from './recallData';

export function getGeminiApiKey(): string {
  // Support both VITE_ and non-prefixed GEMINI_ / GOOGLE_ env variables
  const envKey =
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.GEMINI_API_KEY ||
    import.meta.env.VITE_GOOGLE_API_KEY ||
    import.meta.env.GOOGLE_API_KEY ||
    import.meta.env.GOOGLE_GENAI_API_KEY ||
    import.meta.env.VITE_API_KEY ||
    import.meta.env.API_KEY ||
    ((import.meta as any).env?.VITE_GEMINI_API_KEY) ||
    ((import.meta as any).env?.GEMINI_API_KEY);

  let key = '';
  if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
    key = envKey.trim();
  } else {
    const localKey = localStorage.getItem('gemini_api_key');
    if (localKey && typeof localKey === 'string' && localKey.trim().length > 0) {
      key = localKey.trim();
    }
  }

  // Strip accidental enclosing quotes from .env (e.g. "AIzaSy..." or 'AIzaSy...')
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  return key;
}

export function hasGeminiApiKey(): boolean {
  return getGeminiApiKey().length > 0;
}

export function getGeminiApiKeySource(): 'env' | 'localStorage' | 'none' {
  const envKey =
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.GEMINI_API_KEY ||
    import.meta.env.VITE_GOOGLE_API_KEY ||
    import.meta.env.GOOGLE_API_KEY ||
    import.meta.env.GOOGLE_GENAI_API_KEY ||
    import.meta.env.VITE_API_KEY ||
    import.meta.env.API_KEY ||
    ((import.meta as any).env?.VITE_GEMINI_API_KEY) ||
    ((import.meta as any).env?.GEMINI_API_KEY);

  if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
    return 'env';
  }
  const localKey = localStorage.getItem('gemini_api_key');
  if (localKey && localKey.trim().length > 0) {
    return 'localStorage';
  }
  return 'none';
}

export function setGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed.length > 0) {
    localStorage.setItem('gemini_api_key', trimmed);
  } else {
    localStorage.removeItem('gemini_api_key');
  }
}

export function getMaskedApiKey(): string {
  const key = getGeminiApiKey();
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

export interface AnalyzeImageOptions {
  base64Data: string;
  mimeType: string;
  recallsDataset: RecallItem[];
}

/**
 * Send product image to Gemini 2.5 Flash Lite to extract identifiers and cross reference recalls
 */
export async function analyzeProductImageWithGemini({
  base64Data,
  mimeType,
  recallsDataset
}: AnalyzeImageOptions): Promise<ScanMatchResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please ensure VITE_GEMINI_API_KEY is configured in your .env file.');
  }

  // Strip data:image/...;base64, prefix if present
  let cleanBase64 = base64Data;
  if (cleanBase64.includes('base64,')) {
    cleanBase64 = cleanBase64.split('base64,')[1];
  }

  const promptText = `
You are an expert product safety investigator for the Canadian Recall & Safety Alerts database (Health Canada, CFIA, Transport Canada).
Examine this product packaging image, label, logo, or barcode with extreme forensic precision.

Your goal is to identify the EXACT commercial product shown in the picture so it can be accurately cross-referenced against the Canadian recall database without false positive matches.

Extract and return a JSON object with EXACTLY this structure:
{
  "brand": "Exact manufacturer or brand name visible (e.g. 'Plantropy', 'Great Value', 'Nestlé', 'Kirkland Signature', 'Campbell\\'s', 'Ford', or empty if unknown)",
  "productName": "Exact commercial product name including specific line, flavor, or edition (e.g. 'Jack\\'d Up Bites Jalapeño & Cheddar', 'Cream of Mushroom Condensed Soup', 'Cheerios Honey Nut', 'Tylenol Extra Strength 500mg', 'F-150 SuperCrew')",
  "flavorOrVariant": "Specific flavor, scent, sub-type, or variety (e.g. 'Jalapeño & Cheddar', 'Vanilla', 'Unsweetened', '2% Milk', 'Extra Strength', or empty if none)",
  "packageSize": "Package net weight, volume, or count if visible (e.g. '150 g', '355 mL', '6 pack', or empty)",
  "category": "One of: Food, Consumer Products, Health/Medical, Vehicles, Other",
  "modelOrLot": "Exact model number, lot code, batch number, expiry date, or VIN if visible (or empty if none)",
  "upcOrCode": "UPC or barcode numbers if visible or readable in the image, or empty",
  "searchKeywords": "2 to 4 distinctive compound keywords for exact recall lookup (e.g. 'Plantropy Jack\\'d Up Bites Jalapeno' or 'JKMAX heated blanket')",
  "confidenceNotes": "Brief 1-sentence note of what was observed on the packaging"
}

Important:
- Return ONLY valid JSON. Do not wrap in markdown fences or backticks.
- Be precise: identify the EXACT product, brand, and flavor/variant shown. Do not use generic one-word descriptions like 'snack' or 'car' or 'shampoo'.
`;

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: cleanBase64
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    const rawText = response.text || '';
    let parsed: any;

    try {
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse Gemini JSON output:', parseErr, rawText);
      throw new Error('Failed to interpret Gemini recognition response. Please try again with a clearer photo.');
    }

    const extraction: GeminiExtractionResult = {
      productName: parsed.productName || 'Unknown Product',
      brand: parsed.brand || '',
      category: parsed.category || parsed.detectedCategory || 'Other',
      flavorOrVariant: parsed.flavorOrVariant || '',
      packageSize: parsed.packageSize || '',
      modelOrLot: parsed.modelOrLot || parsed.modelOrBatchNumber || '',
      modelOrBatchNumber: parsed.modelOrLot || parsed.modelOrBatchNumber || '',
      detectedCategory: parsed.category || parsed.detectedCategory || 'Other',
      searchKeywords: parsed.searchKeywords || [parsed.brand, parsed.productName].filter(Boolean).join(' '),
      upcOrCode: parsed.upcOrCode || '',
      confidenceNotes: parsed.confidenceNotes || '',
      isSpecificProduct: Boolean(parsed.brand || parsed.productName)
    };

    // Cross-reference extracted details against the Canadian recall dataset with forensic scoring
    return crossReferenceRecallDataset(extraction, recallsDataset);
  } catch (err: any) {
    console.error('Gemini vision analysis error:', err);
    if (err?.message?.includes('API_KEY_INVALID') || err?.status === 400 || err?.status === 403) {
      throw new Error('Invalid Gemini API Key. Please verify the key in your .env file.');
    }
    throw new Error(err?.message || 'Error processing image with Gemini.');
  }
}

/**
 * Resolves a scanned or entered barcode/UPC/EAN into a product name, brand, and matched recalls.
 * Uses Gemini AI when key is present, with instant local recall matching as fallback.
 */
export async function resolveBarcodeWithGemini(
  barcode: string,
  recallsDataset: RecallItem[]
): Promise<ScanMatchResult> {
  const cleanBarcode = barcode.trim();
  const directMatches = findRecallsByCodeOrQuery(recallsDataset, cleanBarcode);

  let knownBrand = '';
  let knownProduct = '';
  if (directMatches.length > 0) {
    knownProduct = directMatches[0].Product || directMatches[0].Title;
    knownBrand = directMatches[0].Organization || '';
  }

  const apiKey = getGeminiApiKey();

  // If no Gemini API key configured, use local database matching
  if (!apiKey) {
    const identifiedTitle = knownProduct ? `${knownBrand ? knownBrand + ' ' : ''}${knownProduct}` : `Barcode ${cleanBarcode}`;
    const searchKeywords = knownProduct || cleanBarcode;

    return {
      verdict: directMatches.length > 0 ? 'MATCH_FOUND' : 'NO_RECALL_FOUND',
      query: cleanBarcode,
      searchType: 'barcode',
      identifiedTitle,
      searchKeywords,
      extractedInfo: {
        brand: knownBrand,
        productName: knownProduct || `Product ${cleanBarcode}`,
        category: directMatches[0]?.Category || 'Other',
        modelOrLot: cleanBarcode,
        upcOrCode: cleanBarcode,
        searchKeywords
      },
      matchedRecalls: directMatches,
      matchReason: directMatches.length > 0
        ? `Barcode ${cleanBarcode} matched ${directMatches.length} active Canadian safety notice(s).`
        : `Barcode ${cleanBarcode} checked against ${recallsDataset.length.toLocaleString()} Canadian safety recalls. No active notices found.`
    };
  }

  // Use Gemini to identify canonical brand & product title from barcode
  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are a Canadian consumer product and grocery database.
Given the UPC / EAN barcode or lot code "${cleanBarcode}", identify the commercial product and manufacturer name.
Return ONLY a valid JSON object with:
{
  "brand": "Manufacturer or brand name (e.g. Campbell's, Kirkland, Kraft, or empty if unknown)",
  "productName": "Commercial product name and variant (e.g. Cream of Mushroom Soup 284ml)",
  "flavorOrVariant": "Flavor or variant if applicable",
  "packageSize": "Package net weight or size if known",
  "category": "One of: Food, Consumer Products, Health/Medical, Vehicles, Other",
  "searchKeywords": "Distinctive keywords to search recall notices (e.g. brand + product name)"
}`;

    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0.1 }
    });

    const text = (res.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);

    const brand = parsed.brand || knownBrand;
    const productName = parsed.productName || knownProduct;
    const searchKeywords = parsed.searchKeywords || [brand, productName, cleanBarcode].filter(Boolean).join(' ');

    const extraction: GeminiExtractionResult = {
      brand: brand || '',
      productName: productName || `Barcode #${cleanBarcode}`,
      flavorOrVariant: parsed.flavorOrVariant || '',
      packageSize: parsed.packageSize || '',
      category: parsed.category || 'Other',
      modelOrLot: cleanBarcode,
      upcOrCode: cleanBarcode,
      searchKeywords
    };

    let allMatches = directMatches;
    if (allMatches.length === 0 && (brand || productName)) {
      const crossResult = crossReferenceRecallDataset(extraction, recallsDataset);
      allMatches = crossResult.matchedRecalls;
    }

    const hasMatches = allMatches.length > 0;
    const identifiedTitle = [brand, productName].filter(Boolean).join(' ') || `Barcode ${cleanBarcode}`;

    return {
      verdict: hasMatches ? 'MATCH_FOUND' : 'NO_RECALL_FOUND',
      query: cleanBarcode,
      searchType: 'barcode',
      identifiedTitle,
      searchKeywords,
      extractedInfo: extraction,
      matchedRecalls: allMatches,
      matchReason: hasMatches
        ? `Identified: ${identifiedTitle} (UPC ${cleanBarcode}) — matched ${allMatches.length} active Canadian safety notice(s).`
        : `Identified: ${identifiedTitle} (UPC ${cleanBarcode}). Checked against ${recallsDataset.length.toLocaleString()} Canadian safety recalls.`
    };
  } catch (err) {
    console.warn('Gemini barcode lookup fallback:', err);
    const identifiedTitle = knownProduct ? `${knownBrand ? knownBrand + ' ' : ''}${knownProduct}` : `Barcode ${cleanBarcode}`;
    const searchKeywords = knownProduct || cleanBarcode;

    return {
      verdict: directMatches.length > 0 ? 'MATCH_FOUND' : 'NO_RECALL_FOUND',
      query: cleanBarcode,
      searchType: 'barcode',
      identifiedTitle,
      searchKeywords,
      extractedInfo: {
        brand: knownBrand,
        productName: knownProduct || `Product ${cleanBarcode}`,
        category: directMatches[0]?.Category || 'Other',
        modelOrLot: cleanBarcode,
        upcOrCode: cleanBarcode,
        searchKeywords
      },
      matchedRecalls: directMatches,
      matchReason: directMatches.length > 0
        ? `Barcode ${cleanBarcode} matched ${directMatches.length} active Canadian safety notice(s).`
        : `Barcode ${cleanBarcode} checked against ${recallsDataset.length.toLocaleString()} Canadian safety recalls. No active notices found.`
    };
  }
}

// Noise words in recall titles and packaging descriptions (English & French)
const GENERIC_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'for', 'with', 'by', 'to', 'at', 'from',
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'pour', 'avec', 'par',
  'recalled', 'recall', 'recalls', 'rappel', 'rappels', 'alert', 'alerte', 'safety',
  'product', 'products', 'produit', 'produits', 'item', 'items', 'brand', 'marque',
  'certain', 'certains', 'various', 'divers', 'all', 'tous', 'pack', 'pkg', 'size', 'format',
  'net', 'wt', 'weight', 'poids', 'gram', 'grams', 'ml', 'oz', 'kg', 'lb',
  'due', 'because', 'canada', 'canadian', 'canadien', 'canadienne', 'notice', 'avis',
  'number', 'code', 'lot', 'date', 'best', 'before', 'upc', 'inc', 'ltd', 'corp', 'co'
]);

function normalizeClean(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/['"’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDistinctiveTokens(text: string): string[] {
  const norm = normalizeClean(text);
  return norm
    .split(' ')
    .filter((w) => w.length >= 3 && !GENERIC_STOPWORDS.has(w));
}

/**
 * Cross-references extracted product details against the Canadian recall database.
 * Employs forensic matching to guarantee we match the EXACT product in the picture,
 * preventing loose brand false-positives.
 */
export function crossReferenceRecallDataset(
  extracted: GeminiExtractionResult,
  dataset: RecallItem[]
): ScanMatchResult {
  const cleanBrand = normalizeClean(extracted.brand);
  const cleanProduct = normalizeClean(extracted.productName);
  const cleanFlavor = normalizeClean(extracted.flavorOrVariant || '');
  const cleanModel = normalizeClean(extracted.modelOrLot || extracted.modelOrBatchNumber || '');
  const cleanUpc = (extracted.upcOrCode || '').replace(/[^0-9]/g, '');
  const cleanCategory = normalizeClean(extracted.category || extracted.detectedCategory || '');

  const identifiedTitle = [extracted.brand, extracted.productName].filter(Boolean).join(' ') || 'Product';
  const searchKeywords =
    extracted.searchKeywords || [extracted.brand, extracted.productName, extracted.flavorOrVariant].filter(Boolean).join(' ');

  if (!dataset || dataset.length === 0) {
    return {
      verdict: 'NO_RECALL_FOUND',
      query: identifiedTitle,
      searchType: 'vision',
      identifiedTitle,
      searchKeywords,
      extractedInfo: extracted,
      matchedRecalls: [],
      matchReason: 'Database is currently empty or loading.'
    };
  }

  const prodTokens = extractDistinctiveTokens(extracted.productName);
  const flavorTokens = extractDistinctiveTokens(extracted.flavorOrVariant || '');

  // Score candidate items
  interface ScoredRecall {
    item: RecallItem;
    score: number;
    matchType: 'upc' | 'model' | 'exact_product' | 'product_line';
  }

  const scoredCandidates: ScoredRecall[] = [];

  for (const item of dataset) {
    const itemTitle = normalizeClean(item.Title);
    const itemProduct = normalizeClean(item.Product);
    const itemIssue = normalizeClean(item.Issue);
    const itemOrg = normalizeClean(item.Organization);
    const itemCat = normalizeClean(item.Category);
    const fullItemText = `${itemTitle} ${itemProduct} ${itemIssue} ${itemOrg} ${itemCat}`;

    // 1. UPC exact match (100% confidence)
    const digitsOnlyText = fullItemText.replace(/[^0-9]/g, '');
    if (cleanUpc.length >= 8 && (digitsOnlyText.includes(cleanUpc) || fullItemText.includes(cleanUpc))) {
      scoredCandidates.push({ item, score: 100, matchType: 'upc' });
      continue;
    }

    // 2. Model / batch exact match (95% confidence)
    if (cleanModel.length >= 4 && !GENERIC_STOPWORDS.has(cleanModel)) {
      if (itemProduct.includes(cleanModel) || itemTitle.includes(cleanModel)) {
        scoredCandidates.push({ item, score: 95, matchType: 'model' });
        continue;
      }
    }

    // 3. Category incompatibility gate
    // If user photographed a Vehicle, do not match Food recalls, and vice-versa
    if (cleanCategory.includes('vehicle') || cleanCategory.includes('transport') || cleanCategory.includes('car')) {
      if (itemCat.includes('food') || itemOrg.includes('cfia') || itemCat.includes('confectionery')) {
        continue;
      }
    } else if (cleanCategory.includes('food')) {
      if (itemCat.includes('vehicle') || itemOrg.includes('transport') || itemCat.includes('tires')) {
        continue;
      }
    }

    // 4. Brand verification
    let brandMatches = false;
    if (cleanBrand.length >= 2) {
      brandMatches =
        itemTitle.includes(cleanBrand) ||
        itemProduct.includes(cleanBrand) ||
        itemOrg.includes(cleanBrand);

      // If a brand was clearly identified in the photo, and this recall does NOT match that brand,
      // it CANNOT be the exact product!
      if (!brandMatches) {
        continue;
      }
    }

    // 5. Product Name & Line Concordance
    let matchedProdTokensCount = 0;
    if (prodTokens.length > 0) {
      for (const t of prodTokens) {
        if (itemTitle.includes(t) || itemProduct.includes(t)) {
          matchedProdTokensCount++;
        }
      }
    }

    const prodTokenRatio = prodTokens.length > 0 ? matchedProdTokensCount / prodTokens.length : 0;
    const hasPhraseMatch =
      cleanProduct.length >= 4 && (itemTitle.includes(cleanProduct) || itemProduct.includes(cleanProduct));

    // STRICT FILTER: If the product tokens have < 50% coverage and there is NO phrase match,
    // this recall is for a DIFFERENT product from the same brand (e.g. Ford F-150 vs Ford Fiesta,
    // or Nestlé KitKat vs Nestlé Infant Formula). Discard it!
    if (prodTokens.length >= 2 && prodTokenRatio < 0.5 && !hasPhraseMatch) {
      continue;
    }
    if (prodTokens.length === 1 && prodTokenRatio === 0 && !hasPhraseMatch) {
      continue;
    }

    // 6. Calculate Weighted Forensic Score (0 to 100)
    let score = 0;

    // Brand contribution
    if (brandMatches) {
      score += 25;
    }

    // Direct phrase match bonus
    if (hasPhraseMatch) {
      score += 45;
    }

    // Token ratio contribution
    score += Math.round(prodTokenRatio * 35);

    // Flavor / variant concordance
    if (cleanFlavor.length >= 3 || flavorTokens.length > 0) {
      const hasFlavorPhrase = cleanFlavor.length >= 3 && (itemTitle.includes(cleanFlavor) || itemProduct.includes(cleanFlavor));
      let flavorMatchCount = 0;
      for (const ft of flavorTokens) {
        if (itemTitle.includes(ft) || itemProduct.includes(ft)) {
          flavorMatchCount++;
        }
      }
      if (hasFlavorPhrase || flavorMatchCount > 0) {
        score += 15;
      }
    }

    // Only include candidate if score indicates a genuine product line or exact product match
    if (score >= 45) {
      scoredCandidates.push({
        item,
        score: Math.min(100, score),
        matchType: score >= 70 ? 'exact_product' : 'product_line'
      });
    }
  }

  // Sort candidate recalls by match score descending, then by last updated date descending
  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const dateA = a.item['Last updated'] || '';
    const dateB = b.item['Last updated'] || '';
    return dateB.localeCompare(dateA);
  });

  const exactMatches = scoredCandidates.filter((c) => c.score >= 70).map((c) => c.item);
  const possibleMatches = scoredCandidates.filter((c) => c.score >= 45 && c.score < 70).map((c) => c.item);

  const matchedRecalls = exactMatches.length > 0 ? exactMatches : possibleMatches;
  const verdict =
    exactMatches.length > 0
      ? 'MATCH_FOUND'
      : possibleMatches.length > 0
        ? 'POSSIBLE_MATCH'
        : 'NO_RECALL_FOUND';

  const queryUsed = searchKeywords || identifiedTitle;
  const topScore = scoredCandidates[0]?.score || 0;

  let matchReason = '';
  if (verdict === 'MATCH_FOUND') {
    matchReason = `Identified: ${identifiedTitle} — exact product match found in ${exactMatches.length} active Canadian safety notice(s).`;
  } else if (verdict === 'POSSIBLE_MATCH') {
    matchReason = `Identified: ${identifiedTitle} — related notices found for this product line. Verify your packaging codes, lot numbers, or flavors below.`;
  } else {
    matchReason = `Identified: ${identifiedTitle}. No active safety recalls found in the Canadian open data registry (${dataset.length.toLocaleString()} notices checked).`;
  }

  return {
    verdict,
    query: queryUsed,
    searchType: 'vision',
    identifiedTitle,
    searchKeywords,
    extractedInfo: extracted,
    matchedRecalls: matchedRecalls.slice(0, 15),
    matchReason,
    matchScore: topScore
  };
}
