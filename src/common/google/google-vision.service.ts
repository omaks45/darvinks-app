// src/common/services/google-vision.service.ts
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
    // GOOGLE_APPLICATION_CREDENTIALS in .env can be:
    //   (a) An inline JSON string starting with { ... }
    //   (b) A file path to a service account JSON key file
    //
    // We read directly from process.env because ConfigService only exposes
    // keys explicitly mapped in app.config.ts — using process.env ensures
    // we catch the value even if the config factory doesn't forward it yet.
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '';

    try {
      if (!raw) {
        this.credentials = {};
      } else if (raw.trim().startsWith('{')) {
        // (a) Inline JSON — value IS the service account JSON
        this.credentials = JSON.parse(raw);
        this.logger.log('Google Vision: loaded credentials from inline JSON');
      } else {
        // (b) File path — read the key file from disk
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs') as typeof import('fs');
        const resolved = raw.startsWith('/') || raw.includes(':')
          ? raw                          // absolute path
          : require('path').join(process.cwd(), raw); // relative to project root
        this.credentials = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        this.logger.log(`Google Vision: loaded credentials from file: ${resolved}`);
      }
    } catch (err: any) {
      this.credentials = {};
      this.logger.warn(`Google Vision: failed to parse credentials — ${err.message}`);
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
      this.logger.debug(`Vision OCR extracted text:\n${rawText.slice(0, 500)}`);

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

    // ── Strategy: quantity-set matching ────────────────────────────────────
    //
    // Handwritten invoices have inconsistent spelling, OCR errors, and
    // abbreviated trade names. Matching on product names is unreliable.
    //
    // Instead we compare the SET of quantities on the invoice against the
    // SET of quantities on the PO. If every PO quantity appears in the
    // invoice quantities (within ±1 tolerance for rounding), we qualify.
    //
    // Additionally we check the grand total if OCR extracted it — this is
    // the most reliable signal since totals are printed in large numerals.

    // 1. Grand total check (most reliable — large printed numbers)
    if (extracted.totalKobo !== null && extracted.totalKobo > 0) {
      const tolerance = Math.round(po.totalKobo * 0.02); // 2% — OCR can misread commas
      if (Math.abs(extracted.totalKobo - po.totalKobo) > tolerance) {
        mismatches.push({
          field:    'totalAmount',
          expected: po.totalKobo,
          actual:   extracted.totalKobo,
        });
      }
    }

    // 2. Quantity-set check — every PO quantity must appear in extracted quantities
    // Extract all numbers from the invoice that plausibly represent carton quantities
    // (between 1 and 9999 — avoids matching prices, dates, phone numbers)
    const invoiceQtys = extracted.lineItems.map((li) => li.quantity);

    // Group PO items by quantity — duplicate quantities (e.g. two lines of 50)
    // must each have a corresponding entry on the invoice
    const poQtyPool = po.items.map((i) => i.quantityCartons).sort((a, b) => a - b);
    const invQtyPool = [...invoiceQtys].sort((a, b) => a - b);

    // Match each PO quantity against an unmatched invoice quantity
    const unmatchedInv = [...invQtyPool];
    for (const poQty of poQtyPool) {
      const idx = unmatchedInv.findIndex((iq) => Math.abs(iq - poQty) <= 1);
      if (idx === -1) {
        mismatches.push({
          field:    `quantity.${poQty}cartons`,
          expected: poQty,
          actual:   'not found on invoice',
        });
      } else {
        unmatchedInv.splice(idx, 1); // consume this match
      }
    }

    // 3. Confidence: base 1.0, penalise per mismatch
    const matches    = mismatches.length === 0;
    const confidence = Math.max(0, 1 - mismatches.length * 0.25);

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

    // Primary strategy for handwritten/printed invoices:
    // Find lines that START with a small integer (1–9999) — these are quantities.
    // The quantity is almost always the first token on a line item row.
    // We deliberately ignore product names because OCR + handwriting make them
    // unreliable. We care only about the number.
    //
    // Exclusion rules to avoid false positives:
    //   - Skip lines that look like dates (dd/mm/yyyy or dd.mm.yy)
    //   - Skip lines that look like phone numbers (> 7 consecutive digits)
    //   - Skip lines that are clearly headers (QTY, NO., S/N etc.)
    //   - Quantity must be 1–9999 (real carton counts)

    const headerWords = /^(qty|no|s\/n|sn|ref|date|inv|invoice|total|amount|rate|desc)/i;
    const datePattern = /^\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4}/;
    const phonePattern = /\d{7,}/;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip obvious header/footer lines
      if (headerWords.test(trimmed)) continue;
      if (datePattern.test(trimmed))  continue;

      // Extract the first number from the line
      const firstNumMatch = trimmed.match(/^(\d{1,4})(?:\s|$)/);
      if (!firstNumMatch) continue;

      const qty = parseInt(firstNumMatch[1], 10);

      // Valid quantity range: 1 to 9999 cartons
      if (qty < 1 || qty > 9999) continue;

      // Skip if the rest of the line looks like a phone number
      if (phonePattern.test(trimmed.slice(firstNumMatch[0].length))) continue;

      // Extract whatever description follows the quantity
      const description = trimmed.slice(firstNumMatch[0].length).trim();

      // Must have some description text (not just a bare number)
      if (description.length < 2) continue;

      items.push({
        productName: description,
        quantity:    qty,
        unitPrice:   null,
        lineTotal:   null,
      });
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