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
 * Send product image to Gemini 2.5 Flash to extract identifiers and cross reference recalls
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
Inspect this product packaging image, label, logo, or barcode carefully.

Extract and return a JSON object with EXACTLY this structure:
{
  "productName": "Common commercial product name (e.g. Jack'd Up Bites, Peanut Butter, Heated Blanket, Brake Pad)",
  "brand": "Manufacturer or brand name (e.g. Plantropy, Kirkland, Nestle, Ford, Dyson, or empty if unknown)",
  "category": "One of: Food, Consumer Products, Health/Medical, Vehicles, Other",
  "modelOrLot": "Model number, lot code, batch number, or VIN (or empty if none)",
  "searchKeywords": "2 to 4 distinctive keywords for recall database search (e.g. 'Plantropy Jack'd Up Bites' or 'JKMAX heated blanket')",
  "upcOrCode": "UPC or barcode numbers if visible in image, or empty",
  "confidenceNotes": "Brief 1-sentence note of visual findings"
}

Important:
- Return ONLY valid JSON. Do not wrap in markdown fences or backticks.
- Be accurate and extract exact text visible on packaging or labels.
`;

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
      modelOrLot: parsed.modelOrLot || parsed.modelOrBatchNumber || '',
      modelOrBatchNumber: parsed.modelOrLot || parsed.modelOrBatchNumber || '',
      detectedCategory: parsed.category || parsed.detectedCategory || 'Other',
      searchKeywords: parsed.searchKeywords || [parsed.brand, parsed.productName].filter(Boolean).join(' '),
      upcOrCode: parsed.upcOrCode || '',
      confidenceNotes: parsed.confidenceNotes || ''
    };

    // Cross-reference extracted details against the Canadian recall dataset
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
        ? `Product barcode ${cleanBarcode} matched ${directMatches.length} active Canadian safety notice(s).`
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
  "category": "One of: Food, Consumer Products, Health/Medical, Vehicles, Other",
  "searchKeywords": "Distinctive keywords to search recall notices (e.g. brand + product name)"
}`;

    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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

/**
 * Cross-references extracted product details against the Canadian recall database
 */
export function crossReferenceRecallDataset(
  extracted: GeminiExtractionResult,
  dataset: RecallItem[]
): ScanMatchResult {
  const brand = (extracted.brand || '').trim().toLowerCase();
  const product = (extracted.productName || '').trim().toLowerCase();
  const model = (extracted.modelOrLot || extracted.modelOrBatchNumber || '').trim().toLowerCase();
  const upc = (extracted.upcOrCode || '').replace(/[^0-9]/g, '');

  const identifiedTitle = [extracted.brand, extracted.productName].filter(Boolean).join(' ') || 'Product';
  const searchKeywords =
    extracted.searchKeywords || [extracted.brand, extracted.productName].filter(Boolean).join(' ');

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

  const directMatches: RecallItem[] = [];
  const partialMatches: RecallItem[] = [];

  // Filter out very short generic words
  const productTokens = product
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, '').trim())
    .filter((w) => w.length > 2);

  for (const item of dataset) {
    const title = (item.Title || '').toLowerCase();
    const prodDesc = (item.Product || '').toLowerCase();
    const issue = (item.Issue || '').toLowerCase();
    const whatToDo = (item['What you should do'] || '').toLowerCase();
    const fullText = `${title} ${prodDesc} ${issue} ${whatToDo}`;

    // 1. UPC exact match
    if (upc.length >= 8 && fullText.includes(upc)) {
      directMatches.push(item);
      continue;
    }

    // 2. Model / batch exact match
    if (model.length >= 4 && fullText.includes(model)) {
      directMatches.push(item);
      continue;
    }

    // 3. Brand match + product keyword match
    if (brand.length >= 3 && (title.includes(brand) || prodDesc.includes(brand))) {
      const matchingTokens = productTokens.filter((token) => fullText.includes(token));
      if (productTokens.length > 0 && matchingTokens.length >= Math.min(2, productTokens.length)) {
        directMatches.push(item);
        continue;
      }
      partialMatches.push(item);
      continue;
    }

    // 4. Strong product tokens match
    if (!brand && productTokens.length >= 2) {
      const matchCount = productTokens.filter((t) => title.includes(t) || prodDesc.includes(t)).length;
      if (matchCount >= Math.min(3, productTokens.length)) {
        partialMatches.push(item);
      }
    }
  }

  const matchedRecalls = directMatches.length > 0 ? directMatches : partialMatches;
  const verdict =
    directMatches.length > 0
      ? 'MATCH_FOUND'
      : partialMatches.length > 0
        ? 'POSSIBLE_MATCH'
        : 'NO_RECALL_FOUND';

  const queryUsed = searchKeywords || identifiedTitle;

  let matchReason = '';
  if (verdict === 'MATCH_FOUND') {
    matchReason = `Identified: ${identifiedTitle} — matched ${matchedRecalls.length} active Canadian safety notice(s).`;
  } else if (verdict === 'POSSIBLE_MATCH') {
    matchReason = `Identified: ${identifiedTitle} — found related notices. Check model or batch numbers carefully.`;
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
    matchReason
  };
}
