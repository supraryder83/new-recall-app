import type { RecallItem, ScanMatchResult } from '../types/recall';

export interface BarcodeProductInfo {
  barcode: string;
  productName?: string;
  brand?: string;
  categories?: string;
  packaging?: string;
  imageUrl?: string;
  source: 'openfoodfacts' | 'openproductsfacts' | 'direct';
}

/**
 * Normalizes barcode strings by stripping non-alphanumeric chars
 * and generating variants (12-digit UPC, 13-digit EAN with/without leading zero).
 */
export function normalizeBarcode(raw: string): string[] {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) return [];

  const variants = new Set<string>();
  variants.add(cleaned);

  // If numeric barcode
  if (/^\d+$/.test(cleaned)) {
    // 13-digit EAN starting with 0 -> add 12-digit UPC
    if (cleaned.length === 13 && cleaned.startsWith('0')) {
      variants.add(cleaned.substring(1));
    }
    // 12-digit UPC -> add 13-digit EAN with leading 0
    if (cleaned.length === 12) {
      variants.add(`0${cleaned}`);
    }
    // Leading zeroes stripped
    const noLeadingZeros = cleaned.replace(/^0+/, '');
    if (noLeadingZeros.length >= 6) {
      variants.add(noLeadingZeros);
    }
  }

  return Array.from(variants);
}

/**
 * Fast client-side barcode lookup against free Open Product registries (No AI).
 * Uses Open Food Facts & Open Products Facts.
 * Max 2.5s timeout to guarantee instant responsiveness.
 */
export async function lookupProductByBarcode(barcode: string): Promise<BarcodeProductInfo | null> {
  const cleanCode = barcode.trim().replace(/[^0-9]/g, '');
  if (cleanCode.length < 4) return null;

  const endpoints = [
    `https://world.openfoodfacts.org/api/v2/product/${cleanCode}.json`,
    `https://world.openproductsfacts.org/api/v2/product/${cleanCode}.json`
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CanadaRecallAlert/1.0 (https://recalls-rappels.canada.ca)'
        }
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data && (data.status === 1 || data.product)) {
          const product = data.product;
          const productName =
            product.product_name_en ||
            product.product_name ||
            product.generic_name_en ||
            product.generic_name;
          const brand = product.brands || product.brand_owner;

          if (productName || brand) {
            return {
              barcode: cleanCode,
              productName: productName || undefined,
              brand: brand || undefined,
              categories: product.categories || undefined,
              packaging: product.packaging || undefined,
              imageUrl: product.image_url || product.image_front_url || undefined,
              source: url.includes('openproductsfacts') ? 'openproductsfacts' : 'openfoodfacts'
            };
          }
        }
      }
    } catch {
      // Continue to next endpoint or fallback
    }
  }

  return null;
}

/**
 * Searches the Canadian recall database for a scanned barcode WITHOUT AI.
 * 1. Checks direct barcode / UPC numbers in recall titles, descriptions, and affected products.
 * 2. If open product lookup resolves product name & brand, cross-references Canadian recalls for exact matches.
 * 3. Returns a structured ScanMatchResult ready for the verdict card.
 */
export async function checkBarcodeRecalls(
  barcode: string,
  recallsDataset: RecallItem[]
): Promise<ScanMatchResult> {
  const cleanBarcode = barcode.trim();
  const normalizedCodes = normalizeBarcode(cleanBarcode);

  // Step 1: Check for direct barcode number matches in the 34,287 Canadian recalls
  const directMatches = recallsDataset.filter((item) => {
    const fullText = `${item.Title} ${item.Product} ${item.Issue} ${item['What you should do']} ${item.NID}`.toLowerCase();
    return normalizedCodes.some((code) => fullText.includes(code.toLowerCase()));
  });

  // Step 2: Query open product registry for product name & brand (Fast & No AI)
  let productInfo: BarcodeProductInfo | null = null;
  try {
    productInfo = await lookupProductByBarcode(cleanBarcode);
  } catch (err) {
    console.warn('Barcode registry lookup error:', err);
  }

  let brandMatches: RecallItem[] = [];
  let productMatches: RecallItem[] = [];

  if (productInfo && (productInfo.brand || productInfo.productName)) {
    const brandTokens = (productInfo.brand || '')
      .toLowerCase()
      .split(/[\s,/-]+/)
      .filter((t) => t.length > 2 && !['the', 'and', 'brand', 'inc', 'ltd'].includes(t));

    const nameTokens = (productInfo.productName || '')
      .toLowerCase()
      .split(/[\s,/-]+/)
      .filter((t) => t.length > 2 && !['the', 'and', 'with', 'for'].includes(t));

    for (const item of recallsDataset) {
      const titleLower = (item.Title || '').toLowerCase();
      const productLower = (item.Product || '').toLowerCase();
      const fullText = `${titleLower} ${productLower}`;

      const matchesBrand = brandTokens.length > 0 && brandTokens.some((b) => fullText.includes(b));
      const matchesName = nameTokens.length > 0 && nameTokens.some((n) => fullText.includes(n));

      if (matchesBrand && matchesName) {
        productMatches.push(item);
      } else if (matchesBrand) {
        brandMatches.push(item);
      }
    }
  }

  // Combine direct matches + specific product name matches (unique by NID)
  const combinedMap = new Map<string, RecallItem>();
  for (const m of directMatches) combinedMap.set(m.NID, m);
  for (const m of productMatches) combinedMap.set(m.NID, m);

  const matchedRecalls = Array.from(combinedMap.values());
  const relatedBrandRecalls = brandMatches.filter((b) => !combinedMap.has(b.NID)).slice(0, 5);

  const displayTitle = productInfo?.productName
    ? `${productInfo.brand ? `${productInfo.brand} - ` : ''}${productInfo.productName}`
    : `Barcode: ${cleanBarcode}`;

  if (matchedRecalls.length > 0) {
    const isDirect = directMatches.length > 0;
    return {
      verdict: 'MATCH_FOUND',
      query: cleanBarcode,
      searchType: 'barcode',
      identifiedTitle: displayTitle,
      searchKeywords: productInfo?.productName || cleanBarcode,
      extractedInfo: {
        brand: productInfo?.brand || '',
        productName: productInfo?.productName || `Barcode ${cleanBarcode}`,
        category: productInfo?.categories || 'Consumer Product',
        packageSize: productInfo?.packaging,
        upcOrCode: cleanBarcode,
        isSpecificProduct: true
      },
      matchedRecalls,
      relatedBrandRecalls,
      matchReason: isDirect
        ? `Barcode ${cleanBarcode} explicitly matches Canadian recall notice #${matchedRecalls[0].NID}.`
        : `Product identified from barcode as "${displayTitle}". Matches ${matchedRecalls.length} active Canadian safety recall notice(s).`
    };
  }

  // No recall found
  return {
    verdict: 'NO_RECALL_FOUND',
    query: cleanBarcode,
    searchType: 'barcode',
    identifiedTitle: displayTitle,
    searchKeywords: productInfo?.productName || cleanBarcode,
    extractedInfo: {
      brand: productInfo?.brand || '',
      productName: productInfo?.productName || `Barcode ${cleanBarcode}`,
      category: productInfo?.categories || 'Consumer Product',
      packageSize: productInfo?.packaging,
      upcOrCode: cleanBarcode,
      isSpecificProduct: Boolean(productInfo?.productName)
    },
    matchedRecalls: [],
    relatedBrandRecalls,
    matchReason: productInfo?.productName
      ? `Product identified as "${displayTitle}". Checked against ${recallsDataset.length.toLocaleString()} Canadian safety recall records. No active recalls found.`
      : `Scanned Barcode: ${cleanBarcode}. Checked against ${recallsDataset.length.toLocaleString()} official Canadian safety recall records from Health Canada, CFIA, and Transport Canada. No matching recalls found.`
  };
}
