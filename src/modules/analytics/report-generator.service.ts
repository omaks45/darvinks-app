
//
// Generates PPT and Excel reports from AnalyticsReportData.
// Kept separate from AnalyticsService (data) so each concern is tested
// and modified independently — data shape changes don't require touching
// generation logic and vice versa.
//
// Brand colors are sourced directly from id-card.template.html:
//   Primary:   #8B1520  (bright maroon — used as the dominant header color)
//   Dark:      #5C0F18  (dark maroon — used for alternating rows, accents)
//   Darkest:   #3A0810  (near-black red — used for footer bars)
//   Text bg:   #4A0A12  (deep red — used for table header backgrounds)
//   White:     #FFFFFF
//   Light grey:#F5F5F5  (for alternating data rows)

import { Injectable, Logger } from '@nestjs/common';
import PptxGenJS from 'pptxgenjs';
import ExcelJS from 'exceljs';
import type { AnalyticsReportData, LocationPerformanceRow, UserPerformanceRow } from './analytics.service';

// Brand constants
const C = {
    PRIMARY:     '8B1520',
    DARK:        '5C0F18',
    DARKEST:     '3A0810',
    ACCENT:      '4A0A12',
    WHITE:       'FFFFFF',
    LIGHT_GREY:  'F5F5F5',
    MID_GREY:    'CCCCCC',
    TEXT_DARK:   '1A1A1A',
} as const;

// Column widths (inches) for the PPT location table
const LOC_COLS = [2.0, 1.2, 1.2, 1.2, 1.0];   // Location | TGT | ACHV | BAL | %
const USR_COLS = [1.8, 1.0, 1.4, 1.0, 1.0, 1.0, 1.0]; // Name | Ref | Tier | Cat | TGT | ACHV | %

function formatKobo(kobo: number): string {
    return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatCartons(n: number): string {
    return n.toLocaleString('en-NG');
}

@Injectable()
export class ReportGeneratorService {
    private readonly logger = new Logger(ReportGeneratorService.name);

    //PPT

    async generatePpt(
        data: AnalyticsReportData,
        scope: 'personal' | 'org',
        userId?: string,
    ): Promise<Buffer> {
        this.logger.log(`Generating PPT (scope=${scope}, period=${data.periodMonth})`);

        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'WIDESCREEN', width: 10, height: 5.63 });
        pptx.layout = 'WIDESCREEN';

        //  Slide 1: Cover
        this.addCoverSlide(pptx, data);

        //  Slide 2: Org summary (org scope only)
        if (scope === 'org') {
        this.addOrgSummarySlide(pptx, data);
        }

        // Slides 3+: Location performance (TGT/ACHV/BAL)
        if (scope === 'org' && data.locationPerformance.length > 0) {
        this.addLocationPerformanceSlides(pptx, data.locationPerformance);
        }

        // Slides: User performance (personal or all-user for org)
        const perfRows = scope === 'personal' && userId
        ? data.userPerformance.filter((r) => r.userId === userId)
        : data.userPerformance;

        if (perfRows.length > 0) {
        this.addUserPerformanceSlides(pptx, perfRows, scope, data.periodMonth);
        }

        // Final slide: Thank you 
        this.addClosingSlide(pptx, data.periodMonth);

        const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
        return buffer;
    }

    // Excel (org scope only — System Admin) 

    async generateExcel(data: AnalyticsReportData): Promise<Buffer> {
        this.logger.log(`Generating Excel for period=${data.periodMonth}`);

        const workbook = new ExcelJS.Workbook();
        workbook.creator  = 'TB DARVINKS Analytics';
        workbook.created  = data.generatedAt;
        workbook.modified = data.generatedAt;

        // Sheet 1: Org Summary
        this.addOrgSummarySheet(workbook, data);

        // Sheet 2: Location Performance
        if (data.locationPerformance.length > 0) {
        this.addLocationSheet(workbook, data.locationPerformance, data.periodMonth);
        }

        // Sheet 3: User Performance
        if (data.userPerformance.length > 0) {
        this.addUserSheet(workbook, data.userPerformance, data.periodMonth);
        }

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(arrayBuffer);
    }

    // PPT slide builders

    private addCoverSlide(pptx: PptxGenJS, data: AnalyticsReportData) {
        const slide = pptx.addSlide();

        // Full-bleed maroon background
        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: '100%',
        fill: { color: C.DARKEST },
        });

        // Accent bar at top
        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 0.5,
        fill: { color: C.PRIMARY },
        });

        // Company name
        slide.addText('TB DARVINKS', {
        x: 0.5, y: 0.8, w: 9, h: 0.8,
        fontSize: 36, bold: true, color: C.WHITE,
        align: 'center', fontFace: 'Calibri',
        });

        // Report title
        slide.addText('Weekly Sales Performance Report', {
        x: 0.5, y: 1.7, w: 9, h: 0.5,
        fontSize: 18, color: C.MID_GREY,
        align: 'center', fontFace: 'Calibri',
        });

        // Period
        const [y, m] = data.periodMonth.split('-');
        const monthName = new Date(Number(y), Number(m) - 1).toLocaleString('en-NG', { month: 'long', year: 'numeric' });
        slide.addText(monthName, {
        x: 0.5, y: 2.4, w: 9, h: 0.4,
        fontSize: 14, color: C.LIGHT_GREY,
        align: 'center', fontFace: 'Calibri',
        });

        // Generated date
        slide.addText(`Generated: ${data.generatedAt.toLocaleDateString('en-NG')}`, {
        x: 0.5, y: 5.0, w: 9, h: 0.3,
        fontSize: 9, color: C.MID_GREY, align: 'center',
        });

        // Bottom accent bar
        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.33, w: '100%', h: 0.3,
        fill: { color: C.PRIMARY },
        });
    }

    private addOrgSummarySlide(pptx: PptxGenJS, data: AnalyticsReportData) {
        const slide = pptx.addSlide();
        this.addSlideHeader(slide, pptx, 'Organisation Summary');

        const s = data.orgSummary;
        const metrics = [
        ['Active Users',          s.totalActiveUsers.toString()],
        ['Active Customers (KDs)', s.totalActiveCustomers.toString()],
        ['Total Collections',     formatKobo(s.totalCollectionsKobo)],
        ['Total PO Value',        formatKobo(s.totalPOValueKobo)],
        ['Secondary Sale Cartons', formatCartons(s.totalSecondarySaleCartons)],
        ];

        const cols = 3;
        metrics.forEach(([label, value], i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 0.3 + col * 3.2;
        const y = 1.2 + row * 1.5;

        slide.addShape(pptx.ShapeType.rect, {
            x, y, w: 3.0, h: 1.2,
            fill: { color: C.DARK }, line: { color: C.PRIMARY, width: 1 },
        });
        slide.addText(value, {
            x, y: y + 0.15, w: 3.0, h: 0.55,
            fontSize: 20, bold: true, color: C.WHITE, align: 'center',
        });
        slide.addText(label, {
            x, y: y + 0.7, w: 3.0, h: 0.4,
            fontSize: 10, color: C.MID_GREY, align: 'center',
        });
        });
    }

    private addLocationPerformanceSlides(
        pptx: PptxGenJS,
        rows: LocationPerformanceRow[],
    ) {
        // Group by region for one slide per region
        const byRegion = new Map<string, LocationPerformanceRow[]>();
        for (const row of rows) {
        const list = byRegion.get(row.region) ?? [];
        list.push(row);
        byRegion.set(row.region, list);
        }

        for (const [region, regionRows] of byRegion) {
        const slide = pptx.addSlide();
        this.addSlideHeader(slide, pptx, `Location Performance — ${region}`);

        const headers = ['Location', 'Target', 'Achieved', 'Balance', '%'];
        const tableRows: PptxGenJS.TableRow[] = [
            headers.map((h) => ({
            text: h,
            options: {
                bold: true, color: C.WHITE,
                fill: { color: C.ACCENT },
                align: 'center' as const,
            },
            })),
            ...regionRows.slice(0, 20).map((r, idx) => [
            { text: `${r.locationName} (${r.category})`, options: { align: 'left' as const } },
            { text: formatCartons(r.targetValue),   options: { align: 'right' as const } },
            { text: formatCartons(r.achievedValue), options: { align: 'right' as const } },
            { text: formatCartons(r.balanceValue),  options: { align: 'right' as const } },
            {
                text: `${r.percentAchieved}%`,
                options: {
                align: 'center' as const,
                color: r.percentAchieved >= 80 ? '006600'
                    : r.percentAchieved >= 50 ? 'CC6600'
                    : 'CC0000',
                },
            },
            ].map((cell, ci) => ({
            ...cell,
            options: {
                ...cell.options,
                fill: { color: idx % 2 === 0 ? C.LIGHT_GREY : C.WHITE },
                fontSize: 9,
            },
            }))),
        ];

        slide.addTable(tableRows, {
            x: 0.2, y: 1.1, w: 9.6,
            colW: LOC_COLS,
            border: { type: 'solid', color: C.MID_GREY, pt: 0.5 },
            autoPage: false,
        });
        }
    }

    private addUserPerformanceSlides(
        pptx: PptxGenJS,
        rows: UserPerformanceRow[],
        scope: 'personal' | 'org',
        periodMonth: string,
    ) {
        const slide = pptx.addSlide();
        this.addSlideHeader(
        slide, pptx,
        scope === 'personal' ? 'My Performance' : 'Team Performance',
        );

        const headers = ['Name', 'Ref', 'Tier', 'Category', 'Target', 'Achieved', '%'];
        const tableRows: PptxGenJS.TableRow[] = [
        headers.map((h) => ({
            text: h,
            options: {
            bold: true, color: C.WHITE,
            fill: { color: C.ACCENT },
            align: 'center' as const,
            fontSize: 9,
            },
        })),
        ...rows.slice(0, 25).map((r, idx) => [
            { text: r.fullName,    options: { align: 'left' as const } },
            { text: r.employeeRef, options: { align: 'left' as const } },
            { text: r.tier,        options: { align: 'center' as const } },
            { text: r.category,    options: { align: 'center' as const } },
            { text: formatCartons(r.targetCartons),   options: { align: 'right' as const } },
            { text: formatCartons(r.achievedCartons), options: { align: 'right' as const } },
            {
            text: `${r.percentAchieved}%`,
            options: {
                align: 'center' as const,
                color: r.percentAchieved >= 80 ? '006600'
                    : r.percentAchieved >= 50 ? 'CC6600'
                    : 'CC0000',
            },
            },
        ].map((cell) => ({
            ...cell,
            options: {
            ...cell.options,
            fill: { color: idx % 2 === 0 ? C.LIGHT_GREY : C.WHITE },
            fontSize: 8,
            },
        }))),
        ];

        slide.addTable(tableRows, {
        x: 0.2, y: 1.1, w: 9.6,
        colW: USR_COLS,
        border: { type: 'solid', color: C.MID_GREY, pt: 0.5 },
        autoPage: false,
        });
    }

    private addClosingSlide(pptx: PptxGenJS, periodMonth: string) {
        const slide = pptx.addSlide();

        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: '100%',
        fill: { color: C.DARKEST },
        });
        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 0.5,
        fill: { color: C.PRIMARY },
        });
        slide.addText('Thank You', {
        x: 0.5, y: 1.8, w: 9, h: 1,
        fontSize: 40, bold: true, color: C.WHITE, align: 'center',
        });
        slide.addText('Darvinks Healthcare Ltd', {
        x: 0.5, y: 3.2, w: 9, h: 0.5,
        fontSize: 14, color: C.MID_GREY, align: 'center',
        });
        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.33, w: '100%', h: 0.3,
        fill: { color: C.PRIMARY },
        });
    }

    private addSlideHeader(
        slide: PptxGenJS.Slide,
        pptx: PptxGenJS,
        title: string,
    ) {
        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 0.9,
        fill: { color: C.PRIMARY },
        });
        slide.addText(title, {
        x: 0.2, y: 0.1, w: 9.6, h: 0.7,
        fontSize: 18, bold: true, color: C.WHITE, fontFace: 'Calibri',
        });
        // Footer bar
        slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.33, w: '100%', h: 0.3,
        fill: { color: C.DARKEST },
        });
        slide.addText('TB DARVINKS — Confidential', {
        x: 0.2, y: 5.35, w: 9.6, h: 0.25,
        fontSize: 7, color: C.LIGHT_GREY,
        });
    }

    // Excel sheet builders

    private addOrgSummarySheet(workbook: ExcelJS.Workbook, data: AnalyticsReportData) {
        const sheet = workbook.addWorksheet('Summary');
        const headerFill: ExcelJS.Fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: `FF${C.PRIMARY}` },
        };
        const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: `FF${C.WHITE}` } };

        sheet.addRow(['TB DARVINKS — Weekly Performance Report']).font = { bold: true, size: 14 };
        sheet.addRow([`Period: ${data.periodMonth}`]);
        sheet.addRow([`Generated: ${data.generatedAt.toLocaleDateString('en-NG')}`]);
        sheet.addRow([]);

        const hRow = sheet.addRow(['Metric', 'Value']);
        hRow.eachCell((cell) => { cell.fill = headerFill; cell.font = headerFont; });

        const s = data.orgSummary;
        const metrics = [
        ['Active Users',           s.totalActiveUsers],
        ['Active Customers',       s.totalActiveCustomers],
        ['Total Collections',      formatKobo(s.totalCollectionsKobo)],
        ['Total PO Value',         formatKobo(s.totalPOValueKobo)],
        ['Secondary Sale Cartons', s.totalSecondarySaleCartons],
        ];
        metrics.forEach(([label, value]) => sheet.addRow([label, value]));

        sheet.getColumn(1).width = 30;
        sheet.getColumn(2).width = 25;
    }

    private addLocationSheet(
        workbook: ExcelJS.Workbook,
        rows: LocationPerformanceRow[],
        periodMonth: string,
    ) {
        const sheet = workbook.addWorksheet('Location Performance');
        const headerFill: ExcelJS.Fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: `FF${C.PRIMARY}` },
        };
        const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: `FF${C.WHITE}` } };

        const hRow = sheet.addRow([
        'Location', 'State', 'Region', 'Category',
        'Target', 'Achieved', 'Balance', '% Achieved',
        ]);
        hRow.eachCell((cell) => { cell.fill = headerFill; cell.font = headerFont; });

        rows.forEach((r, idx) => {
        const row = sheet.addRow([
            r.locationName, r.state, r.region, r.category,
            r.targetValue, r.achievedValue, r.balanceValue, r.percentAchieved / 100,
        ]);
        if (idx % 2 === 0) {
            row.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.LIGHT_GREY}` } };
            });
        }
        // Format percentage column
        row.getCell(8).numFmt = '0%';
        // Colour-code percentage
        const pct = r.percentAchieved;
        row.getCell(8).font = {
            color: { argb: pct >= 80 ? 'FF006600' : pct >= 50 ? 'FFCC6600' : 'FFCC0000' },
        };
        });

        [28, 14, 18, 14, 12, 12, 12, 14].forEach((w, i) => {
        sheet.getColumn(i + 1).width = w;
        });

        // Auto-filter on header row
        sheet.autoFilter = { from: 'A1', to: 'H1' };
    }

    private addUserSheet(
        workbook: ExcelJS.Workbook,
        rows: UserPerformanceRow[],
        periodMonth: string,
    ) {
        const sheet = workbook.addWorksheet('User Performance');
        const headerFill: ExcelJS.Fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: `FF${C.PRIMARY}` },
        };
        const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: `FF${C.WHITE}` } };

        const hRow = sheet.addRow([
        'Full Name', 'Employee Ref', 'Tier', 'Region', 'Category',
        'Target (Cartons)', 'Achieved (Cartons)', 'Balance', '% Achieved',
        ]);
        hRow.eachCell((cell) => { cell.fill = headerFill; cell.font = headerFont; });

        rows.forEach((r, idx) => {
        const row = sheet.addRow([
            r.fullName, r.employeeRef, r.tier, r.region ?? '', r.category,
            r.targetCartons, r.achievedCartons, r.balanceCartons, r.percentAchieved / 100,
        ]);
        if (idx % 2 === 0) {
            row.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.LIGHT_GREY}` } };
            });
        }
        row.getCell(9).numFmt = '0%';
        const pct = r.percentAchieved;
        row.getCell(9).font = {
            color: { argb: pct >= 80 ? 'FF006600' : pct >= 50 ? 'FFCC6600' : 'FFCC0000' },
        };
        });

        [24, 16, 18, 16, 14, 18, 18, 14, 14].forEach((w, i) => {
        sheet.getColumn(i + 1).width = w;
        });
        sheet.autoFilter = { from: 'A1', to: 'I1' };
    }
}