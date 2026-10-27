import { GoogleGenAI } from '@google/genai';
import type { GeminiExtractionResult, RecallItem, ScanMatchResult } from '../types/recall';
import { findRecallsByCodeOrQuery } from './recallData';
import { lookupProductByBarcode } from './barcodeRecall';

/**
 * Primary model used for AI visual product, serial number, and packaging recognition
 */
export const GEMINI_VISION_MODEL = 'gemini-3.5-flash-lite';

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
  base64Data?: string;
  mimeType?: string;
  itemImage?: {
    base64Data: string;
    mimeType?: string;
  };
  tagImage?: {
    base64Data: string;
    mimeType?: string;
  };
  recallsDataset: RecallItem[];
}

/**
 * Send 2 product photos (overall item + up-close serial/model tag) to Gemini 3.5 Flash Lite
 * to extract identifiers and cross reference Canadian safety recalls.
 */
export async function analyzeProductImageWithGemini({
  base64Data,
  mimeType = 'image/jpeg',
  itemImage,
  tagImage,
  recallsDataset
}: AnalyzeImageOptions): Promise<ScanMatchResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('API key is missing. Please ensure your API key is configured in settings or .env file.');
  }

  // Extract clean base64 data for item photo (Photo 1)
  const rawItemData = itemImage?.base64Data || base64Data || '';
  let cleanItemBase64 = rawItemData;
  if (cleanItemBase64.includes('base64,')) {
    cleanItemBase64 = cleanItemBase64.split('base64,')[1];
  }
  const itemMime = itemImage?.mimeType || mimeType || 'image/jpeg';

  // Extract clean base64 data for tag photo (Photo 2) if provided
  const rawTagData = tagImage?.base64Data || '';
  let cleanTagBase64 = rawTagData;
  if (cleanTagBase64.includes('base64,')) {
    cleanTagBase64 = cleanTagBase64.split('base64,')[1];
  }
  const tagMime = tagImage?.mimeType || 'image/jpeg';

  if (!cleanItemBase64 && !cleanTagBase64) {
    throw new Error('No product photo provided for analysis.');
  }

  const promptText = `
You are an expert product safety investigator for the Canadian Recall & Safety Alerts database (Health Canada, CFIA, Transport Canada).
You are analyzing ${cleanTagBase64 ? 'TWO forensic photos of a product: Photo 1 is the overall commercial item/packaging, and Photo 2 is an up-close capture of the serial number (SN), model number, rating plate, or tag.' : 'a photo of the product/label.'}

Your mission is to extract the EXACT manufacturer, product line, model number, serial number (SN), and lot/batch code so this item can be verified against the official Canadian recall database with zero false positives.

Carefully inspect:
1. OVERALL ITEM (Photo 1): Identify the exact brand, product type, form factor, color, edition, and commercial name.
${cleanTagBase64 ? '2. SERIAL & MODEL TAG (Photo 2): Read the exact model number, model code, serial number (SN), date code, lot number, certification numbers, or UPC printed on the rating label, tag, or engraved plate.' : '2. Look for any visible model numbers, serial numbers, lot codes, or barcodes on the packaging.'}

Extract and return a JSON object with EXACTLY this structure:
{
  "brand": "Exact manufacturer or brand name (e.g. 'Dyson', 'DeWalt', 'Samsung', 'LG', 'Plantropy', 'Great Value', 'Honda', 'Fisher-Price')",
  "productName": "Exact commercial product name including edition or line (e.g. 'V11 Animal Cordless Vacuum', '20V MAX Cordless Drill', 'Jack\\'d Up Bites Jalapeño & Cheddar')",
  "modelOrLot": "Exact model number or lot code visible on the tag or packaging (e.g. 'DCD771C2', 'SV14', 'LOT 2024-08-A', or empty if none)",
  "serialNumber": "Exact serial number (SN) if visible on the tag (e.g. 'SN 98472910384', or empty if none)",
  "flavorOrVariant": "Specific variant, flavor, size, or sub-model if applicable",
  "packageSize": "Package net weight, volume, or dimensions if visible",
  "category": "One of: Food, Consumer Products, Health/Medical, Vehicles, Other",
  "upcOrCode": "UPC or barcode numbers if readable, or empty",
  "searchKeywords": "2 to 4 distinctive compound keywords for exact recall lookup (e.g. 'Dyson V11 vacuum' or 'DeWalt DCD771 drill')",
  "confidenceNotes": "Brief 1-sentence note of what was observed across the photos"
}

Important:
- Return ONLY valid JSON. Do not wrap in markdown fences or backticks.
- Be forensic: prioritize the model number and serial number from the up-close tag photo whenever available.
`;

  const parts: any[] = [{ text: promptText }];

  // Photo 1: Overall Item
  if (cleanItemBase64) {
    parts.push({
      inlineData: {
        mimeType: itemMime,
        data: cleanItemBase64
      }
    });
  }

  // Photo 2: Up-close SN & Model Tag
  if (cleanTagBase64) {
    parts.push({
      inlineData: {
        mimeType: tagMime,
        data: cleanTagBase64
      }
    });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_VISION_MODEL,
      contents: [{ role: 'user', parts }],
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
      console.error('Failed to parse AI recognition JSON output:', parseErr, rawText);
      throw new Error('Failed to interpret recognition response. Please try again with clear photos of the item and model tag.');
    }

    const extraction: GeminiExtractionResult = {
      productName: parsed.productName || 'Unknown Product',
      brand: parsed.brand || '',
      category: parsed.category || parsed.detectedCategory || 'Other',
      flavorOrVariant: parsed.flavorOrVariant || '',
      packageSize: parsed.packageSize || '',
      modelOrLot: parsed.modelOrLot || parsed.modelOrBatchNumber || '',
      modelOrBatchNumber: parsed.modelOrLot || parsed.modelOrBatchNumber || '',
      serialNumber: parsed.serialNumber || '',
      detectedCategory: parsed.category || parsed.detectedCategory || 'Other',
      searchKeywords: parsed.searchKeywords || [parsed.brand, parsed.productName, parsed.modelOrLot].filter(Boolean).join(' '),
      upcOrCode: parsed.upcOrCode || '',
      confidenceNotes: parsed.confidenceNotes || '',
      isSpecificProduct: Boolean(parsed.brand || parsed.productName)
    };

    // Cross-reference extracted details against the Canadian recall dataset with forensic scoring
    const matchResult = crossReferenceRecallDataset(extraction, recallsDataset);
    return {
      ...matchResult,
      searchType: 'camera',
      itemImage: rawItemData || undefined,
      tagImage: rawTagData || undefined
    };
  } catch (err: any) {
    console.error('Vision analysis error:', err);
    if (err?.message?.includes('API_KEY_INVALID') || err?.status === 400 || err?.status === 403) {
      throw new Error('Invalid API Key. Please verify your configured key in settings.');
    }
    throw new Error(err?.message || 'Error processing product image.');
  }
}

/**
 * Resolves a scanned or entered barcode/UPC/EAN into a product name, brand, and matched recalls.
 * Uses Gemini AI when key is present, with instant open registry & local recall matching as fallback.
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

  // Fast offline lookup: Try open product registries (Open Food Facts / Open Products Facts)
  let openProductInfo: any = null;
  try {
    openProductInfo = await lookupProductByBarcode(cleanBarcode);
    if (openProductInfo) {
      if (!knownBrand && openProductInfo.brand) knownBrand = openProductInfo.brand;
      if (!knownProduct && openProductInfo.productName) knownProduct = openProductInfo.productName;
    }
  } catch {}

  const apiKey = getGeminiApiKey();

  // If no Gemini API key configured, use local database matching & open registry product resolution
  if (!apiKey) {
    let allMatches = directMatches;
    let crossResult: ScanMatchResult | null = null;
    if (allMatches.length === 0 && (knownBrand || knownProduct)) {
      crossResult = crossReferenceRecallDataset(
        {
          brand: knownBrand,
          productName: knownProduct || `Barcode ${cleanBarcode}`,
          category: openProductInfo?.categories || directMatches[0]?.Category || 'Other',
          modelOrLot: cleanBarcode,
          upcOrCode: cleanBarcode,
          searchKeywords: [knownBrand, knownProduct, cleanBarcode].filter(Boolean).join(' ')
        },
        recallsDataset
      );
      allMatches = crossResult.matchedRecalls;
    }

    const hasMatches = allMatches.length > 0;
    const isPossible = crossResult?.verdict === 'POSSIBLE_MATCH';
    const identifiedTitle = knownProduct
      ? `${knownBrand ? knownBrand + ' ' : ''}${knownProduct}`
      : `Barcode ${cleanBarcode}`;
    const searchKeywords = knownProduct || cleanBarcode;

    return {
      verdict: hasMatches ? 'MATCH_FOUND' : isPossible ? 'POSSIBLE_MATCH' : 'NO_RECALL_FOUND',
      query: cleanBarcode,
      searchType: 'barcode',
      identifiedTitle,
      searchKeywords,
      extractedInfo: {
        brand: knownBrand,
        productName: knownProduct || `Product ${cleanBarcode}`,
        category: openProductInfo?.categories || directMatches[0]?.Category || 'Other',
        modelOrLot: cleanBarcode,
        upcOrCode: cleanBarcode,
        searchKeywords
      },
      matchedRecalls: allMatches,
      similarProductRecalls: crossResult?.similarProductRecalls || [],
      relatedBrandRecalls: crossResult?.relatedBrandRecalls || [],
      matchReason: hasMatches
        ? `Barcode ${cleanBarcode} matched ${allMatches.length} active Canadian safety notice(s).`
        : isPossible
        ? `Barcode ${cleanBarcode} identified as "${identifiedTitle}". Potential safety notice found for related model line.`
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
      model: GEMINI_VISION_MODEL,
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
    let crossResult: ScanMatchResult | null = null;
    if (allMatches.length === 0 && (brand || productName)) {
      crossResult = crossReferenceRecallDataset(extraction, recallsDataset);
      allMatches = crossResult.matchedRecalls;
    }

    const hasMatches = allMatches.length > 0;
    const isPossible = crossResult?.verdict === 'POSSIBLE_MATCH';
    const identifiedTitle = [brand, productName].filter(Boolean).join(' ') || `Barcode ${cleanBarcode}`;

    return {
      verdict: hasMatches ? 'MATCH_FOUND' : isPossible ? 'POSSIBLE_MATCH' : 'NO_RECALL_FOUND',
      query: cleanBarcode,
      searchType: 'barcode',
      identifiedTitle,
      searchKeywords,
      extractedInfo: extraction,
      matchedRecalls: allMatches,
      similarProductRecalls: crossResult?.similarProductRecalls || [],
      relatedBrandRecalls: crossResult?.relatedBrandRecalls || [],
      matchReason: hasMatches
        ? `Identified: ${identifiedTitle} (UPC ${cleanBarcode}) — matched ${allMatches.length} active Canadian safety notice(s).`
        : isPossible
        ? `Identified: ${identifiedTitle} (UPC ${cleanBarcode}) — potential recall notice found for related model line.`
        : `Identified: ${identifiedTitle} (UPC ${cleanBarcode}). Checked against ${recallsDataset.length.toLocaleString()} Canadian safety recalls.`
    };
  } catch (err) {
    console.warn('Gemini barcode lookup fallback:', err);
    let allMatches = directMatches;
    let crossResult: ScanMatchResult | null = null;
    if (allMatches.length === 0 && (knownBrand || knownProduct)) {
      crossResult = crossReferenceRecallDataset(
        {
          brand: knownBrand,
          productName: knownProduct || `Product ${cleanBarcode}`,
          category: openProductInfo?.categories || directMatches[0]?.Category || 'Other',
          modelOrLot: cleanBarcode,
          upcOrCode: cleanBarcode,
          searchKeywords: [knownBrand, knownProduct, cleanBarcode].filter(Boolean).join(' ')
        },
        recallsDataset
      );
      allMatches = crossResult.matchedRecalls;
    }

    const hasMatches = allMatches.length > 0;
    const isPossible = crossResult?.verdict === 'POSSIBLE_MATCH';
    const identifiedTitle = knownProduct
      ? `${knownBrand ? knownBrand + ' ' : ''}${knownProduct}`
      : `Barcode ${cleanBarcode}`;
    const searchKeywords = knownProduct || cleanBarcode;

    return {
      verdict: hasMatches ? 'MATCH_FOUND' : isPossible ? 'POSSIBLE_MATCH' : 'NO_RECALL_FOUND',
      query: cleanBarcode,
      searchType: 'barcode',
      identifiedTitle,
      searchKeywords,
      extractedInfo: {
        brand: knownBrand,
        productName: knownProduct || `Product ${cleanBarcode}`,
        category: openProductInfo?.categories || directMatches[0]?.Category || 'Other',
        modelOrLot: cleanBarcode,
        upcOrCode: cleanBarcode,
        searchKeywords
      },
      matchedRecalls: allMatches,
      similarProductRecalls: crossResult?.similarProductRecalls || [],
      relatedBrandRecalls: crossResult?.relatedBrandRecalls || [],
      matchReason: hasMatches
        ? `Barcode ${cleanBarcode} matched ${allMatches.length} active Canadian safety notice(s).`
        : isPossible
        ? `Barcode ${cleanBarcode} identified as "${identifiedTitle}". Potential safety notice found for related model line.`
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

// Model modifier tokens (these describe model tier or edition rather than the core noun)
const MODIFIER_WORDS = new Set([
  'pro', 'max', 'plus', 'ultra', 'mini', 'inch', 'gen', 'edition', 'series', 'standard', 'classic', 'new', 'original'
]);

// Corporate suffix noise to strip when extracting pure brand tokens
const COMPANY_NOISE = new Set([
  'inc', 'corp', 'corporation', 'ltd', 'limited', 'llc', 'cie', 'co', 'company',
  'canada', 'canadian', 'group', 'enterprises', 'brands', 'brand', 'products', 'bicycles', 'kids'
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
  return norm.split(' ').filter((w) => {
    if (GENERIC_STOPWORDS.has(w)) return false;
    // Keep numbers and alphanumeric codes (e.g. '4', 'x5', 'v11', '100', 'cat6')
    if (/\d/.test(w)) return true;
    return w.length >= 3;
  });
}

function tokenMatchesText(token: string, targetText: string): boolean {
  if (!token || !targetText) return false;
  if (targetText.includes(token)) return true;
  // Plural/singular stemming (e.g. lounger vs loungers, bicycle vs bicycles, bite vs bites)
  if (token.endsWith('s') && targetText.includes(token.slice(0, -1))) return true;
  if (token.endsWith('es') && targetText.includes(token.slice(0, -2))) return true;
  if (!token.endsWith('s') && (targetText.includes(token + 's') || targetText.includes(token + 'es'))) return true;
  return false;
}

/**
 * Cross-references extracted product details against the Canadian recall database.
 * Employs forensic matching to guarantee accurate detection of recalled products
 * while preventing false positives.
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

  // Extract distinctive brand tokens (e.g. "Norco Bicycles" -> ["norco"])
  const brandTokens = cleanBrand
    .split(' ')
    .filter((t) => t.length >= 2 && !COMPANY_NOISE.has(t) && !GENERIC_STOPWORDS.has(t));

  const prodTokens = extractDistinctiveTokens(extracted.productName);
  const coreProdTokens = prodTokens.filter((t) => !MODIFIER_WORDS.has(t) && !/^[0-9]+$/.test(t));
  const flavorTokens = extractDistinctiveTokens(extracted.flavorOrVariant || '');

  interface ScoredRecall {
    item: RecallItem;
    score: number;
    matchType: 'upc' | 'model' | 'exact_product' | 'similar_variant' | 'brand_other';
  }

  const exactCandidates: ScoredRecall[] = [];
  const similarCandidates: ScoredRecall[] = [];
  const brandCandidates: ScoredRecall[] = [];

  for (const item of dataset) {
    const itemTitle = normalizeClean(item.Title);
    const itemProduct = normalizeClean(item.Product);
    const itemIssue = normalizeClean(item.Issue);
    const itemWhat = normalizeClean(item['What you should do']);
    const itemOrg = normalizeClean(item.Organization);
    const itemCat = normalizeClean(item.Category);
    const fullItemText = `${itemTitle} ${itemProduct} ${itemIssue} ${itemWhat} ${itemOrg} ${itemCat}`;

    // 1. UPC exact match (100% confidence)
    if (cleanUpc.length >= 8) {
      const fullDigits = fullItemText.replace(/[^0-9]/g, '');
      const noLeadingZero = cleanUpc.replace(/^0+/, '');
      if (
        fullDigits.includes(cleanUpc) ||
        (noLeadingZero.length >= 7 && fullDigits.includes(noLeadingZero)) ||
        fullDigits.includes('0' + cleanUpc) ||
        fullItemText.includes(cleanUpc)
      ) {
        exactCandidates.push({ item, score: 100, matchType: 'upc' });
        continue;
      }
    }

    // 2. Brand matching check
    let brandMatches = false;
    if (cleanBrand.length >= 2) {
      if (itemTitle.includes(cleanBrand) || itemProduct.includes(cleanBrand) || itemOrg.includes(cleanBrand)) {
        brandMatches = true;
      } else if (
        brandTokens.length > 0 &&
        brandTokens.some((bt) => itemTitle.includes(bt) || itemProduct.includes(bt) || itemOrg.includes(bt))
      ) {
        brandMatches = true;
      }
    }

    // 3. Model / batch exact match (95% confidence)
    if (cleanModel.length >= 3 && !GENERIC_STOPWORDS.has(cleanModel)) {
      const cleanModelNoSpaces = cleanModel.replace(/[^a-z0-9]/g, '');
      const itemTitleNoSpaces = itemTitle.replace(/[^a-z0-9]/g, '');
      const itemProductNoSpaces = itemProduct.replace(/[^a-z0-9]/g, '');
      const itemWhatNoSpaces = itemWhat.replace(/[^a-z0-9]/g, '');

      if (
        (itemProduct.includes(cleanModel) ||
          itemTitle.includes(cleanModel) ||
          itemWhat.includes(cleanModel) ||
          (cleanModelNoSpaces.length >= 4 &&
            (itemProductNoSpaces.includes(cleanModelNoSpaces) ||
              itemTitleNoSpaces.includes(cleanModelNoSpaces) ||
              itemWhatNoSpaces.includes(cleanModelNoSpaces)))) &&
        (brandMatches || !cleanBrand)
      ) {
        exactCandidates.push({ item, score: 95, matchType: 'model' });
        continue;
      }
    }

    // 3b. Serial number exact match (98% confidence)
    const cleanSerial = normalizeClean(extracted.serialNumber || '');
    if (cleanSerial.length >= 4 && !GENERIC_STOPWORDS.has(cleanSerial)) {
      const cleanSerialNoSpaces = cleanSerial.replace(/[^a-z0-9]/g, '');
      const itemWhatNoSpaces = itemWhat.replace(/[^a-z0-9]/g, '');
      if (
        (itemProduct.includes(cleanSerial) ||
          itemTitle.includes(cleanSerial) ||
          itemWhat.includes(cleanSerial) ||
          itemWhatNoSpaces.includes(cleanSerialNoSpaces)) &&
        (brandMatches || !cleanBrand)
      ) {
        exactCandidates.push({ item, score: 98, matchType: 'model' });
        continue;
      }
    }

    // 4. Category incompatibility gate
    const isVehicleCategory =
      cleanCategory.includes('vehicle') || cleanCategory.includes('transport') || cleanCategory.includes('car');
    const isFoodCategory = cleanCategory.includes('food');
    const isRecallVehicle = itemCat.includes('vehicle') || itemOrg.includes('transport') || itemCat.includes('tires');
    const isRecallFood = itemCat.includes('food') || itemOrg.includes('cfia') || itemCat.includes('confectionery');

    if ((isVehicleCategory && isRecallFood) || (isFoodCategory && isRecallVehicle)) {
      continue;
    }

    // 5. Product Name & Token Concordance
    const hasPhraseMatch =
      cleanProduct.length >= 4 && (itemTitle.includes(cleanProduct) || itemProduct.includes(cleanProduct));

    // Core token validation (e.g. 'iPhone' must match if present; prevents 'iPhone 15 Pro' matching 'MacBook Pro')
    const coreTokenMatched =
      coreProdTokens.length === 0 ||
      coreProdTokens.some((ct) => tokenMatchesText(ct, itemTitle) || tokenMatchesText(ct, itemProduct));

    if (!coreTokenMatched && !hasPhraseMatch) {
      if (brandMatches && cleanBrand.length >= 2) {
        brandCandidates.push({ item, score: 25, matchType: 'brand_other' });
      }
      continue;
    }

    let matchedProdTokensCount = 0;
    if (prodTokens.length > 0) {
      for (const t of prodTokens) {
        if (tokenMatchesText(t, itemTitle) || tokenMatchesText(t, itemProduct)) {
          matchedProdTokensCount++;
        }
      }
    }

    const prodTokenRatio = prodTokens.length > 0 ? matchedProdTokensCount / prodTokens.length : 0;

    // 6. Flavor / Variant Concordance
    let flavorMatches = false;
    if (cleanFlavor.length >= 3) {
      flavorMatches = tokenMatchesText(cleanFlavor, itemTitle) || tokenMatchesText(cleanFlavor, itemProduct);
    } else if (flavorTokens.length > 0) {
      flavorMatches = flavorTokens.some(
        (ft) => tokenMatchesText(ft, itemTitle) || tokenMatchesText(ft, itemProduct)
      );
    }

    // 7. Calculate Forensic Match Score (0 to 100)
    let score = 0;
    if (brandMatches) score += 30;
    score += Math.round(prodTokenRatio * 40);
    if (hasPhraseMatch) score += 25;
    if (flavorMatches) score += 15;

    // Boost if distinctive digits in product name matched (e.g. '4' in 'storm 4', '11' in 'v11')
    const hasDistinctiveDigit = prodTokens.some(
      (t) => /\d/.test(t) && (tokenMatchesText(t, itemTitle) || tokenMatchesText(t, itemProduct))
    );
    if (hasDistinctiveDigit) score += 15;

    const brandSatisfied = brandMatches || !cleanBrand;
    // If brand was explicitly extracted, require brand concordance for exact product candidates
    if (cleanBrand.length >= 2 && !brandMatches) {
      continue;
    }

    const significantTokens =
      prodTokens.length <= 1
        ? prodTokenRatio === 1.0 && (hasPhraseMatch || brandMatches)
        : prodTokens.length === 2
        ? prodTokenRatio >= 0.5
        : prodTokenRatio >= 0.6;

    const flavorMismatch =
      cleanFlavor.length >= 3 &&
      !flavorMatches &&
      (itemTitle.includes('flavor') || itemTitle.includes('flavour') || itemTitle.includes('variety'));

    // EXACT CANDIDATES: High confidence match for the scanned product
    if (score >= 50 && brandSatisfied && (hasPhraseMatch || significantTokens) && !flavorMismatch) {
      exactCandidates.push({ item, score: Math.min(100, score), matchType: 'exact_product' });
    }
    // SIMILAR VARIANT / PRODUCT LINE CANDIDATES: Score 40-79 or same brand with partial name
    else if (
      (score >= 40 && (brandMatches || hasPhraseMatch)) ||
      (brandMatches && (hasPhraseMatch || prodTokenRatio >= 0.4 || flavorMismatch))
    ) {
      similarCandidates.push({ item, score: Math.max(score, 45), matchType: 'similar_variant' });
    }
    // OTHER PRODUCT FROM THE SAME BRAND
    else if (brandMatches && cleanBrand.length >= 2) {
      brandCandidates.push({ item, score: Math.max(score, 25), matchType: 'brand_other' });
    }
  }

  // Sort candidate recalls by match score descending, then by last updated date descending
  const sortByScoreAndDate = (a: ScoredRecall, b: ScoredRecall) => {
    if (b.score !== a.score) return b.score - a.score;
    const dateA = a.item['Last updated'] || '';
    const dateB = b.item['Last updated'] || '';
    return dateB.localeCompare(dateA);
  };

  exactCandidates.sort(sortByScoreAndDate);
  similarCandidates.sort(sortByScoreAndDate);
  brandCandidates.sort(sortByScoreAndDate);

  const exactMatches = exactCandidates.map((c) => c.item);
  const similarMatches = similarCandidates
    .map((c) => c.item)
    .filter((item) => !exactCandidates.some((e) => e.item.NID === item.NID));
  const brandMatchesList = brandCandidates
    .map((c) => c.item)
    .filter(
      (item) =>
        !exactCandidates.some((e) => e.item.NID === item.NID) &&
        !similarCandidates.some((s) => s.item.NID === item.NID)
    );

  let verdict: 'MATCH_FOUND' | 'POSSIBLE_MATCH' | 'NO_RECALL_FOUND' = 'NO_RECALL_FOUND';
  if (exactMatches.length > 0) {
    verdict = 'MATCH_FOUND';
  } else if (similarMatches.length > 0 && (similarCandidates[0]?.score || 0) >= 65) {
    verdict = 'POSSIBLE_MATCH';
  }

  const queryUsed = searchKeywords || identifiedTitle;
  const topScore = exactCandidates[0]?.score || similarCandidates[0]?.score || 0;

  let matchReason = '';
  if (verdict === 'MATCH_FOUND') {
    matchReason = `Identified: ${identifiedTitle} — EXACT product match found in ${exactMatches.length} active Canadian safety notice(s).`;
  } else if (verdict === 'POSSIBLE_MATCH') {
    matchReason = `Identified: ${identifiedTitle} — Potential recall notice found for related model/variation (${similarMatches.length} notice(s)). Please inspect affected models.`;
  } else {
    matchReason = `Identified: ${identifiedTitle}. No active safety recalls found for this product in the Canadian registry (${dataset.length.toLocaleString()} notices checked).`;
  }

  return {
    verdict,
    query: queryUsed,
    searchType: 'vision',
    identifiedTitle,
    searchKeywords,
    extractedInfo: extracted,
    matchedRecalls: exactMatches.slice(0, 15),
    similarProductRecalls: similarMatches.slice(0, 10),
    relatedBrandRecalls: brandMatchesList.slice(0, 5),
    matchReason,
    matchScore: topScore
  };
}
