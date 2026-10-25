import { GoogleGenAI } from '@google/genai';
import type { GeminiExtractionResult, RecallItem, ScanMatchResult } from '../types/recall';

export function getGeminiApiKey(): string {
  const env = (import.meta as any).env;
  const envKey = env?.VITE_GEMINI_API_KEY || env?.GEMINI_API_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
    return envKey.trim();
  }
  const localKey = localStorage.getItem('gemini_api_key');
  return localKey ? localKey.trim() : '';
}

export function hasGeminiApiKey(): boolean {
  return getGeminiApiKey().length > 0;
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
Analyze this image of a product label, grocery package, device, vehicle VIN/make plate, or receipt.

Extract and return a JSON object with EXACTLY this structure:
{
  "brand": "Manufacturer or brand name (e.g. Kirkland, Nestle, Ford, Dyson, or empty if unknown)",
  "productName": "Common name or product description (e.g. Peanut Butter, Heated Blanket, Brake Pad)",
  "modelOrBatchNumber": "Model number, lot code, batch number, or VIN (e.g. JK-200, Lot 84920, 1HGCR2F8... or empty if none)",
  "detectedCategory": "One of: Food, Consumer Products, Health/Medical, Vehicles, Other",
  "upcOrCode": "UPC or barcode numbers if visible in image, or empty",
  "confidenceNotes": "Brief 1-sentence note of what was observed on the label"
}

Important:
- Return ONLY the raw valid JSON object. Do not wrap in markdown or backticks.
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
    let parsed: GeminiExtractionResult;

    try {
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse Gemini JSON output:', rawText);
      throw new Error('Failed to interpret Gemini recognition response. Please try again with a clearer photo.');
    }

    // Cross-reference extracted details against the Canadian recall dataset
    return crossReferenceRecallDataset(parsed, recallsDataset);
  } catch (err: any) {
    console.error('Gemini vision analysis error:', err);
    if (err?.message?.includes('API_KEY_INVALID') || err?.status === 400 || err?.status === 403) {
      throw new Error('Invalid Gemini API Key. Please verify the key in your .env file.');
    }
    throw new Error(err?.message || 'Error processing image with Gemini.');
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
  const model = (extracted.modelOrBatchNumber || '').trim().toLowerCase();
  const upc = (extracted.upcOrCode || '').replace(/[^0-9]/g, '');

  if (!dataset || dataset.length === 0) {
    return {
      verdict: 'NO_RECALL_FOUND',
      query: `${extracted.brand} ${extracted.productName}`.trim(),
      searchType: 'vision',
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

  const queryUsed = [extracted.brand, extracted.productName, extracted.modelOrBatchNumber]
    .filter(Boolean)
    .join(' ');

  let matchReason = '';
  if (verdict === 'MATCH_FOUND') {
    matchReason = `Identified active safety alert matching ${extracted.brand ? extracted.brand + ' ' : ''}${extracted.productName}.`;
  } else if (verdict === 'POSSIBLE_MATCH') {
    matchReason = `Found related safety alerts mentioning ${extracted.brand || extracted.productName}. Please check batch/lot numbers carefully.`;
  } else {
    matchReason = `No active safety recalls found in the Canadian open data registry for "${queryUsed}".`;
  }

  return {
    verdict,
    query: queryUsed,
    searchType: 'vision',
    extractedInfo: extracted,
    matchedRecalls: matchedRecalls.slice(0, 10),
    matchReason
  };
}
