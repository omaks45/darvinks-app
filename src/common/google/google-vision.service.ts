
// Uses Google Cloud Vision API to extract text from invoice images/PDFs
// and compares the extracted line items against the Purchase Order.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface InvoiceLineItem {
  productName: string;
  quantity:    number;
  unitPrice:   number | null;
  lineTotal:   number | null;
}

export interface InvoiceExtractionResult {
  rawText:   string;
  lineItems: InvoiceLineItem[];
  totalKobo: number | null;
}

export interface ComparisonResult {
  matches:    boolean;
  mismatches: Array<{
    field:    string;
    expected: string | number;
    actual:   string | number;
  }>;
  confidence: number; // 0–1
}

@Injectable()
export class GoogleVisionService {
  private readonly logger = new Logger(GoogleVisionService.name);
  private readonly credentials: Record<string, unknown>;
  private readonly endpoint = 'https://vision.googleapis.com/v1/images:annotate';

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS_JSON') ?? '{}';
    try {
      this.credentials = JSON.parse(raw);
    } catch {
      this.credentials = {};
      this.logger.warn('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON');
    }
  }

  // ── Text extraction ────────────────────────────────────────────────────────

  /**
   * Sends an image URL or base64 content to Vision API for OCR.
   * Returns the full extracted text and parsed line items.
   */
  async extractInvoiceText(
    imageUrl: string,
  ): Promise<InvoiceExtractionResult> {
    if (!this.credentials.client_email) {
      this.logger.warn('Google Vision credentials not configured');
      return { rawText: '', lineItems: [], totalKobo: null };
    }

    try {
      const accessToken = await this.getAccessToken();
      const response    = await fetch(`${this.endpoint}?access_token=${accessToken}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          requests: [{
            image:    { source: { imageUri: imageUrl } },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          }],
        }),
      });

      const json = await response.json() as {
        responses: Array<{
          fullTextAnnotation?: { text: string };
          error?: { message: string };
        }>;
      };

      if (json.responses[0]?.error) {
        throw new Error(json.responses[0].error.message);
      }

      const rawText = json.responses[0]?.fullTextAnnotation?.text ?? '';

      return {
        rawText,
        lineItems: this.parseLineItems(rawText),
        totalKobo: this.parseTotal(rawText),
      };
    } catch (err) {
      this.logger.error(`Vision OCR failed for ${imageUrl}`, err);
      return { rawText: '', lineItems: [], totalKobo: null };
    }
  }

  // ── PO vs Invoice comparison ───────────────────────────────────────────────

  /**
   * Compares extracted invoice data against the Purchase Order.
   * Returns a detailed mismatch report used to qualify/disqualify the invoice.
   */
  compareWithPO(
    extracted: InvoiceExtractionResult,
    po: {
      totalKobo:  number;
      items: Array<{
        product:         { name: string; category: string };
        quantityCartons: number;
        lineTotalKobo:   number;
      }>;
    },
  ): ComparisonResult {
    const mismatches: ComparisonResult['mismatches'] = [];

    // 1. Total amount check
    if (extracted.totalKobo !== null) {
      const tolerance = Math.round(po.totalKobo * 0.01); // 1% tolerance for rounding
      if (Math.abs(extracted.totalKobo - po.totalKobo) > tolerance) {
        mismatches.push({
          field:    'totalAmount',
          expected: po.totalKobo,
          actual:   extracted.totalKobo,
        });
      }
    }

    // 2. Line item quantity checks
    for (const poItem of po.items) {
      const matchedLine = extracted.lineItems.find((li) =>
        li.productName
          .toLowerCase()
          .includes(poItem.product.name.toLowerCase().split(' ')[0]),
      );

      if (!matchedLine) {
        mismatches.push({
          field:    `item.${poItem.product.name}`,
          expected: poItem.quantityCartons,
          actual:   'not found on invoice',
        });
        continue;
      }

      if (matchedLine.quantity !== poItem.quantityCartons) {
        mismatches.push({
          field:    `item.${poItem.product.name}.quantity`,
          expected: poItem.quantityCartons,
          actual:   matchedLine.quantity,
        });
      }
    }

    const matches    = mismatches.length === 0;
    // Confidence: penalise for each unmatched field
    const confidence = Math.max(0, 1 - mismatches.length * 0.2);

    return { matches, mismatches, confidence };
  }

  // ── Private — JWT auth for Vision API ────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    // Build a signed JWT for Google service account auth
    const now     = Math.floor(Date.now() / 1000);
    const payload = {
      iss:   this.credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-vision',
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600,
    };

    const header    = { alg: 'RS256', typ: 'JWT' };
    const toSign    = `${this.b64(header)}.${this.b64(payload)}`;
    const signature = await this.signRS256(toSign, this.credentials.private_key as string);
    const jwt       = `${toSign}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  jwt,
      }),
    });

    const tokenJson = await tokenRes.json() as { access_token: string };
    return tokenJson.access_token;
  }

  private b64(obj: object): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
  }

  private async signRS256(data: string, privateKey: string): Promise<string> {
    const crypto = await import('crypto');
    const sign   = crypto.createSign('SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKey, 'base64url');
  }

  // ── Private — text parsing ─────────────────────────────────────────────────

  private parseLineItems(text: string): InvoiceLineItem[] {
    const lines = text.split('\n').filter((l) => l.trim());
    const items: InvoiceLineItem[] = [];

    // Look for lines containing quantity patterns (e.g. "12 cartons", "x12", "QTY: 12")
    const qtyRegex    = /(\d+)\s*(cartons?|ctns?|pcs?|units?|x)/i;
    const priceRegex  = /[₦N#]\s*([\d,]+(?:\.\d{2})?)/;

    for (const line of lines) {
      const qtyMatch   = line.match(qtyRegex);
      const priceMatch = line.match(priceRegex);

      if (qtyMatch) {
        items.push({
          productName: line.replace(qtyRegex, '').replace(priceRegex, '').trim(),
          quantity:    parseInt(qtyMatch[1], 10),
          unitPrice:   null,
          lineTotal:   priceMatch
            ? Math.round(parseFloat(priceMatch[1].replace(/,/g, '')) * 100)
            : null,
        });
      }
    }

    return items;
  }

  private parseTotal(text: string): number | null {
    // Look for TOTAL or GRAND TOTAL patterns
    const totalRegex = /(?:grand\s+)?total[:\s]+[₦N#]?\s*([\d,]+(?:\.\d{2})?)/i;
    const match      = text.match(totalRegex);

    if (!match) return null;

    const amount = parseFloat(match[1].replace(/,/g, ''));
    return isNaN(amount) ? null : Math.round(amount * 100);
  }
  /**
   * Convenience method used by PurchaseOrderService.
   * Extracts text from the invoice URL then compares against PO line items.
   */
  async compareInvoiceToPO(
    invoiceUrl: string,
    poItems: Array<{
      productName:     string;
      quantityCartons: number;
      unitPriceKobo:   number;
      lineTotalKobo:   number;
    }>,
  ): Promise<{
    qualified:  boolean;
    summary:    string;
    confidence: number;
    mismatches: ComparisonResult['mismatches'];
  }> {
    const extracted = await this.extractInvoiceText(invoiceUrl);

    const totalKobo = poItems.reduce((sum, i) => sum + i.lineTotalKobo, 0);
    const comparison = this.compareWithPO(extracted, {
      totalKobo,
      items: poItems.map((i) => ({
        product:         { name: i.productName, category: '' },
        quantityCartons: i.quantityCartons,
        lineTotalKobo:   i.lineTotalKobo,
      })),
    });

    const summary = comparison.matches
      ? 'Invoice matches PO — all items and amounts verified'
      : `${comparison.mismatches.length} mismatch(es) found: ` +
        comparison.mismatches.map((m) => m.field).join(', ');

    return {
      qualified:  comparison.matches,
      summary,
      confidence: comparison.confidence,
      mismatches: comparison.mismatches,
    };
  }
}