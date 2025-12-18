'use client';

import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Download,
  FileText,
  FileUp,
  Trash2,
  Filter,
  Loader2,
  Settings,
  UploadCloud,
  Pencil,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type PeriodKey = string; // unique ID for a file/period
type UserKey = string;

type Totals = {
  mono: number;
  color: number;
  blank: number;
  total: number;
  adobePdf: number;
  copy: number;
  msExcel: number;
  msPowerPoint: number;
  msWord: number;
  simplex: number;
  duplex: number;
  otherApplication: number;
  print: number;
};

const TOTAL_KEYS: (keyof Totals)[] = [
  'mono',
  'color',
  'blank',
  'total',
  'adobePdf',
  'copy',
  'msExcel',
  'msPowerPoint',
  'msWord',
  'simplex',
  'duplex',
  'otherApplication',
  'print',
];

type PrinterUsage = {
  deviceModel: string;
  ipHostname: string;
  ipAddress: string;
  totals: Totals;
};

type UserData = {
  totals: Totals; // Overall totals across all printers
  printerUsage: PrinterUsage[]; // Per-printer usage breakdown
};

function mergeUserData(target: UserData, source: UserData): UserData {
  const mergedTotals = { ...target.totals };
  for (const key of TOTAL_KEYS) {
    mergedTotals[key] += source.totals[key];
  }
  return {
    totals: mergedTotals,
    printerUsage: [...target.printerUsage, ...source.printerUsage],
  };
}

type ColumnKey = keyof Omit<Totals, 'blank' | 'print'>; // Remove blank and print

type ColumnConfig = {
  key: ColumnKey;
  label: string;
  shortLabel: string;
};

type ReportPeriod = {
  id: PeriodKey;
  fileName: string;
  dateCreated?: Date;
  rangeStart?: Date;
  rangeEnd?: Date;
  periodLabel: string; // human readable label derived from range or filename
  users: Record<UserKey, UserData>; // changed from Totals to UserData
  grandTotals: Totals;
};

type Aggregated = {
  periods: ReportPeriod[];
  overallRange?: { start: Date; end: Date };
  allUsers: UserKey[];
  allPrinters: string[];
};

const totalsSchema = z.object({
  mono: z.number().nonnegative().finite(),
  color: z.number().nonnegative().finite(),
  blank: z.number().nonnegative().finite(),
  total: z.number().nonnegative().finite(),
  adobePdf: z.number().nonnegative().finite(),
  copy: z.number().nonnegative().finite(),
  msExcel: z.number().nonnegative().finite(),
  msPowerPoint: z.number().nonnegative().finite(),
  msWord: z.number().nonnegative().finite(),
  simplex: z.number().nonnegative().finite(),
  duplex: z.number().nonnegative().finite(),
  otherApplication: z.number().nonnegative().finite(),
  print: z.number().nonnegative().finite(),
});

const AVAILABLE_COLUMNS: ColumnConfig[] = [
  { key: 'mono', label: 'Mono', shortLabel: 'Mono' },
  { key: 'color', label: 'Color', shortLabel: 'Color' },
  { key: 'adobePdf', label: 'Adobe PDF', shortLabel: 'PDF' },
  { key: 'msExcel', label: 'MS Excel', shortLabel: 'Excel' },
  { key: 'msPowerPoint', label: 'MS PowerPoint', shortLabel: 'PowerPoint' },
  { key: 'msWord', label: 'MS Word', shortLabel: 'Word' },
  { key: 'otherApplication', label: 'Other Apps', shortLabel: 'Other Apps' },
  { key: 'total', label: 'Total', shortLabel: 'Total' },
];

const DEFAULT_REPORT_OWNER = 'General';

function parseIntSafe(v: string): number {
  const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

const COLUMN_INDEXES = {
  MONO: 7,
  COLOR: 8,
  BLANK: 9,
  TOTAL: 10,
  ADOBE_PDF: 13,
  COPY: 14,
  MS_EXCEL: 19,
  MS_POWERPOINT: 20,
  MS_WORD: 21,
  OTHER_APPLICATION: 22,
  PRINT: 24,
  SIMPLEX: 27,
  DUPLEX: 28,
} as const;

function parseDateStrict(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return undefined;
  const mm = Number.parseInt(m[1], 10);
  const dd = Number.parseInt(m[2], 10);
  const yyyy = Number.parseInt(m[3], 10);
  const d = new Date(yyyy, mm - 1, dd);
  return isNaN(d.getTime()) ? undefined : d;
}

function toPrettyDate(d?: Date | string): string {
  if (!d) return 'Unknown';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-UK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function derivePeriodLabel(
  rangeStart?: Date,
  rangeEnd?: Date,
  fallback?: string
): string {
  if (rangeStart && rangeEnd) {
    const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
    const startFmt = new Intl.DateTimeFormat('en-UK', {
      month: 'short',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
    }).format(rangeStart);
    const endFmt = new Intl.DateTimeFormat('en-UK', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(rangeEnd);
    return `${startFmt} \u2192 ${endFmt}`;
  }
  return fallback ?? 'Unknown Period';
}

function formatPrinterName(printerName: string): string {
  // First, try to extract number + letter pattern (like 10A, 9B, etc.)
  const numberLetterMatch = printerName.match(/(\d+)([A-Z])$/i);
  if (numberLetterMatch) {
    return `${numberLetterMatch[1]}${numberLetterMatch[2].toUpperCase()}`;
  }

  // Try to find number followed by underscore and letter (like 10_A, 9_B)
  const underscoreMatch = printerName.match(/(\d+)_([A-Z])$/i);
  if (underscoreMatch) {
    return `${underscoreMatch[1]}${underscoreMatch[2].toUpperCase()}`;
  }

  // Try to find any number in the name and letter at the end after underscore
  const numberInNameMatch = printerName.match(/.*?(\d+).*_([A-Z])$/i);
  if (numberInNameMatch) {
    return `${numberInNameMatch[1]}${numberInNameMatch[2].toUpperCase()}`;
  }

  // Handle cases like "9TH_FLOOR_PRINTER" -> "9A"
  const floorPrinterMatch = printerName.match(/(\d+)TH_FLOOR_PRINTER$/i);
  if (floorPrinterMatch) {
    return `${floorPrinterMatch[1]}A`;
  }

  // Handle cases like "9_FLOOR_PRINTER" -> "9A"
  const floorMatch = printerName.match(/(\d+)_FLOOR_PRINTER$/i);
  if (floorMatch) {
    return `${floorMatch[1]}A`;
  }

  // Handle general floor patterns like "FLOOR_9_PRINTER" -> "9A"
  const generalFloorMatch = printerName.match(/FLOOR_(\d+)_PRINTER$/i);
  if (generalFloorMatch) {
    return `${generalFloorMatch[1]}A`;
  }

  // If it's already short (like 9A, 10B), use it as is
  if (printerName.length <= 4 && /\d+[A-Z]/i.test(printerName)) {
    return printerName.toUpperCase();
  }

  // If no clear pattern, return a shortened version (first 4 characters or less)
  return printerName.length <= 4
    ? printerName.toUpperCase()
    : printerName.substring(0, 4).toUpperCase();
}

async function parseReportHtml(
  html: string,
  fileName: string
): Promise<ReportPeriod> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  let dateCreated: Date | undefined;
  let rangeStart: Date | undefined;
  let rangeEnd: Date | undefined;

  const headerTable =
    doc.querySelector('table#header') ?? doc.querySelector('table');
  if (headerTable) {
    const rows = Array.from(
      headerTable.querySelectorAll<HTMLTableRowElement>('tr')
    );
    for (const tr of rows) {
      const th = tr.querySelector('th')?.textContent?.trim();
      const td = tr.querySelector('td')?.textContent?.trim();
      if (!th || !td) continue;
      if (/^date created$/i.test(th)) {
        const m = td.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        dateCreated = parseDateStrict(m?.[1]);
      } else if (/^date range$/i.test(th)) {
        const m = td.match(
          /(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
        );
        rangeStart = parseDateStrict(m?.[1]);
        rangeEnd = parseDateStrict(m?.[2]);
      }
    }
  }

  const usersData: Record<UserKey, UserData> = {};

  const groupHeaders = Array.from(
    doc.querySelectorAll<HTMLTableRowElement>('tr.group_hdr')
  );
  for (const gh of groupHeaders) {
    if (!/user/i.test(gh.textContent ?? '')) continue;
    const usernameRow =
      gh.parentElement?.querySelector<HTMLTableRowElement>(
        'tr:nth-of-type(2)'
      );
    const username =
      usernameRow?.querySelector('td')?.textContent?.trim() ?? 'Unknown User';

    // Initialize user data if not exists
    if (!usersData[username]) {
      usersData[username] = {
        totals: {
          mono: 0,
          color: 0,
          blank: 0,
          total: 0,
          adobePdf: 0,
          copy: 0,
          msExcel: 0,
          msPowerPoint: 0,
          msWord: 0,
          simplex: 0,
          duplex: 0,
          otherApplication: 0,
          print: 0,
        },
        printerUsage: [],
      };
    }

    // Find all data rows for this user (not just the first one)
    const allRows = Array.from(
      doc.querySelectorAll<HTMLTableRowElement>('tr')
    );
    const idx = allRows.indexOf(gh);

    let foundColumnHeader = false;
    for (let i = idx + 1; i < allRows.length; i++) {
      const tr = allRows[i];

      // Stop if we hit another group header
      if (tr.classList.contains('group_hdr')) break;

      // Mark when we find the column header
      if (tr.classList.contains('column_hdr')) {
        foundColumnHeader = true;
        continue;
      }

      // Skip separator rows
      if (tr.querySelector('hr') != null) continue;

      // Process data rows after we've found the column header
      if (foundColumnHeader && tr.querySelectorAll('td').length > 10) {
        const cells = Array.from(tr.querySelectorAll('td')).map(
          (td) => td.textContent?.trim() ?? ''
        );

        // Skip if this looks like a totals row
        if (
          tr.classList.contains('totals') ||
          cells[0]?.toLowerCase().includes('total')
        )
          continue;

        // Extract printer information - printer name is in IP Hostname field
        const deviceModel = cells[0] ?? 'Unknown Device';
        const printerName = cells[1] ?? 'Unknown Printer'; // This is the actual printer name
        const ipAddress = cells[2] ?? 'Unknown IP';

        // Updated column mapping
        const mono = parseIntSafe(cells[COLUMN_INDEXES.MONO] ?? '0');
        const color = parseIntSafe(cells[COLUMN_INDEXES.COLOR] ?? '0');
        const blank = parseIntSafe(cells[COLUMN_INDEXES.BLANK] ?? '0');
        const total = parseIntSafe(
          cells[COLUMN_INDEXES.TOTAL] ?? String(mono + color + blank)
        );
        const adobePdf = parseIntSafe(cells[COLUMN_INDEXES.ADOBE_PDF] ?? '0');
        const copy = parseIntSafe(cells[COLUMN_INDEXES.COPY] ?? '0');
        const msExcel = parseIntSafe(cells[COLUMN_INDEXES.MS_EXCEL] ?? '0');
        const msPowerPoint = parseIntSafe(
          cells[COLUMN_INDEXES.MS_POWERPOINT] ?? '0'
        );
        const msWord = parseIntSafe(cells[COLUMN_INDEXES.MS_WORD] ?? '0');
        const otherApplication = parseIntSafe(
          cells[COLUMN_INDEXES.OTHER_APPLICATION] ?? '0'
        );
        const print = parseIntSafe(cells[COLUMN_INDEXES.PRINT] ?? '0');
        const simplex = parseIntSafe(cells[COLUMN_INDEXES.SIMPLEX] ?? '0');
        const duplex = parseIntSafe(cells[COLUMN_INDEXES.DUPLEX] ?? '0');

        const parsed = totalsSchema.safeParse({
          mono,
          color,
          blank,
          total,
          adobePdf,
          copy,
          msExcel,
          msPowerPoint,
          msWord,
          simplex,
          duplex,
          otherApplication,
          print,
        });

        if (!parsed.success) continue;

        const userData = usersData[username];

        // Find existing printer usage or create new one
        let printerUsage = userData.printerUsage.find(
          (p) => p.ipHostname === printerName && p.ipAddress === ipAddress
        );

        if (!printerUsage) {
          printerUsage = {
            deviceModel,
            ipHostname: printerName,
            ipAddress,
            totals: {
              mono: 0,
              color: 0,
              blank: 0,
              total: 0,
              adobePdf: 0,
              copy: 0,
              msExcel: 0,
              msPowerPoint: 0,
              msWord: 0,
              simplex: 0,
              duplex: 0,
              otherApplication: 0,
              print: 0,
            },
          };
          userData.printerUsage.push(printerUsage);
        }

        // Add to printer-specific totals
        printerUsage.totals.mono += parsed.data.mono;
        printerUsage.totals.color += parsed.data.color;
        printerUsage.totals.blank += parsed.data.blank;
        printerUsage.totals.total += parsed.data.total;
        printerUsage.totals.adobePdf += parsed.data.adobePdf;
        printerUsage.totals.copy += parsed.data.copy;
        printerUsage.totals.msExcel += parsed.data.msExcel;
        printerUsage.totals.msPowerPoint += parsed.data.msPowerPoint;
        printerUsage.totals.msWord += parsed.data.msWord;
        printerUsage.totals.simplex += parsed.data.simplex;
        printerUsage.totals.duplex += parsed.data.duplex;
        printerUsage.totals.otherApplication += parsed.data.otherApplication;
        printerUsage.totals.print += parsed.data.print;

        // Add to overall user totals
        userData.totals.mono += parsed.data.mono;
        userData.totals.color += parsed.data.color;
        userData.totals.blank += parsed.data.blank;
        userData.totals.total += parsed.data.total;
        userData.totals.adobePdf += parsed.data.adobePdf;
        userData.totals.copy += parsed.data.copy;
        userData.totals.msExcel += parsed.data.msExcel;
        userData.totals.msPowerPoint += parsed.data.msPowerPoint;
        userData.totals.msWord += parsed.data.msWord;
        userData.totals.simplex += parsed.data.simplex;
        userData.totals.duplex += parsed.data.duplex;
        userData.totals.otherApplication += parsed.data.otherApplication;
        userData.totals.print += parsed.data.print;
      }
    }
  }

  const grand: Totals = {
    mono: 0,
    color: 0,
    blank: 0,
    total: 0,
    adobePdf: 0,
    copy: 0,
    msExcel: 0,
    msPowerPoint: 0,
    msWord: 0,
    simplex: 0,
    duplex: 0,
    otherApplication: 0,
    print: 0,
  };
  const grandRow = doc.querySelector('tr.totals');
  if (grandRow) {
    const cells = Array.from(grandRow.querySelectorAll('td')).map(
      (td) => td.textContent?.trim() ?? ''
    );
    grand.mono = parseIntSafe(cells[COLUMN_INDEXES.MONO] ?? '0');
    grand.color = parseIntSafe(cells[COLUMN_INDEXES.COLOR] ?? '0');
    grand.blank = parseIntSafe(cells[COLUMN_INDEXES.BLANK] ?? '0');
    grand.total = parseIntSafe(cells[COLUMN_INDEXES.TOTAL] ?? '0');
    grand.adobePdf = parseIntSafe(cells[COLUMN_INDEXES.ADOBE_PDF] ?? '0');
    grand.copy = parseIntSafe(cells[COLUMN_INDEXES.COPY] ?? '0');
    grand.msExcel = parseIntSafe(cells[COLUMN_INDEXES.MS_EXCEL] ?? '0');
    grand.msPowerPoint = parseIntSafe(
      cells[COLUMN_INDEXES.MS_POWERPOINT] ?? '0'
    );
    grand.msWord = parseIntSafe(cells[COLUMN_INDEXES.MS_WORD] ?? '0');
    grand.otherApplication = parseIntSafe(
      cells[COLUMN_INDEXES.OTHER_APPLICATION] ?? '0'
    );
    grand.print = parseIntSafe(cells[COLUMN_INDEXES.PRINT] ?? '0');
    grand.simplex = parseIntSafe(cells[COLUMN_INDEXES.SIMPLEX] ?? '0');
    grand.duplex = parseIntSafe(cells[COLUMN_INDEXES.DUPLEX] ?? '0');
  } else {
    for (const userData of Object.values(usersData)) {
      const u = userData.totals;
      grand.mono += u.mono;
      grand.color += u.color;
      grand.blank += u.blank;
      grand.total += u.total;
      grand.adobePdf += u.adobePdf;
      grand.copy += u.copy;
      grand.msExcel += u.msExcel;
      grand.msPowerPoint += u.msPowerPoint;
      grand.msWord += u.msWord;
      grand.simplex += u.simplex;
      grand.duplex += u.duplex;
      grand.otherApplication += u.otherApplication;
      grand.print += u.print;
    }
  }

  const periodLabel = derivePeriodLabel(rangeStart, rangeEnd, fileName);

  const id = `${fileName}::${rangeStart?.toISOString() ?? 'unknown'}::${
    rangeEnd?.toISOString() ?? 'unknown'
  }`;

  return {
    id,
    fileName,
    dateCreated,
    rangeStart,
    rangeEnd,
    periodLabel,
    users: usersData,
    grandTotals: grand,
  };
}

function computeAggregated(periods: ReportPeriod[]): Aggregated {
  const sorted = [...periods].sort((a, b) => {
    const ad = a.rangeStart?.getTime() ?? a.dateCreated?.getTime() ?? 0;
    const bd = b.rangeStart?.getTime() ?? b.dateCreated?.getTime() ?? 0;
    return ad - bd;
  });

  let overallStart: Date | undefined;
  let overallEnd: Date | undefined;
  for (const p of sorted) {
    if (p.rangeStart && (!overallStart || p.rangeStart < overallStart))
      overallStart = p.rangeStart;
    if (p.rangeEnd && (!overallEnd || p.rangeEnd > overallEnd))
      overallEnd = p.rangeEnd;
  }

  const allUsers = Array.from(
    new Set(sorted.flatMap((p) => Object.keys(p.users)))
  ).sort((a, b) => a.localeCompare(b));

  // Extract all unique printer names from IP Hostname field
  const allPrinters = Array.from(
    new Set(
      sorted.flatMap((p) =>
        Object.values(p.users).flatMap((userData) =>
          userData.printerUsage.map((pu) => pu.ipHostname)
        )
      )
    )
  ).sort((a, b) => a.localeCompare(b));

  return {
    periods: sorted,
    overallRange:
      overallStart && overallEnd
        ? { start: overallStart, end: overallEnd }
        : undefined,
    allUsers,
    allPrinters,
  };
}

function aggregateUsersForSelected(
  periods: ReportPeriod[],
  selectedPrinters?: Set<string>
): Record<UserKey, UserData> {
  const agg: Record<UserKey, UserData> = {};

  for (const p of periods) {
    for (const [user, userData] of Object.entries(p.users)) {
      // Filter printer usage based on selected printers
      const relevantPrinterUsage =
        selectedPrinters && selectedPrinters.size > 0
          ? userData.printerUsage.filter((pu) =>
              selectedPrinters.has(pu.ipHostname)
            )
          : userData.printerUsage;

      // Skip users with no relevant printer usage
      if (relevantPrinterUsage.length === 0) continue;

      if (!agg[user]) {
        agg[user] = {
          totals: {
            mono: 0,
            color: 0,
            blank: 0,
            total: 0,
            adobePdf: 0,
            copy: 0,
            msExcel: 0,
            msPowerPoint: 0,
            msWord: 0,
            simplex: 0,
            duplex: 0,
            otherApplication: 0,
            print: 0,
          },
          printerUsage: [],
        };
      }

      const userAgg = agg[user];

      // Aggregate only the relevant printer usage
      for (const printerUsage of relevantPrinterUsage) {
        // Add to totals
        userAgg.totals.mono += printerUsage.totals.mono;
        userAgg.totals.color += printerUsage.totals.color;
        userAgg.totals.blank += printerUsage.totals.blank;
        userAgg.totals.total += printerUsage.totals.total;
        userAgg.totals.adobePdf += printerUsage.totals.adobePdf;
        userAgg.totals.copy += printerUsage.totals.copy;
        userAgg.totals.msExcel += printerUsage.totals.msExcel;
        userAgg.totals.msPowerPoint += printerUsage.totals.msPowerPoint;
        userAgg.totals.msWord += printerUsage.totals.msWord;
        userAgg.totals.simplex += printerUsage.totals.simplex;
        userAgg.totals.duplex += printerUsage.totals.duplex;
        userAgg.totals.otherApplication += printerUsage.totals.otherApplication;
        userAgg.totals.print += printerUsage.totals.print;

        // Add printer usage if not already present
        const exists = userAgg.printerUsage.some(
          (p) =>
            p.ipHostname === printerUsage.ipHostname &&
            p.ipAddress === printerUsage.ipAddress
        );
        if (!exists) {
          userAgg.printerUsage.push({ ...printerUsage });
        } else {
          // Merge with existing
          const existing = userAgg.printerUsage.find(
            (p) =>
              p.ipHostname === printerUsage.ipHostname &&
              p.ipAddress === printerUsage.ipAddress
          )!;
          existing.totals.mono += printerUsage.totals.mono;
          existing.totals.color += printerUsage.totals.color;
          existing.totals.blank += printerUsage.totals.blank;
          existing.totals.total += printerUsage.totals.total;
          existing.totals.adobePdf += printerUsage.totals.adobePdf;
          existing.totals.copy += printerUsage.totals.copy;
          existing.totals.msExcel += printerUsage.totals.msExcel;
          existing.totals.msPowerPoint += printerUsage.totals.msPowerPoint;
          existing.totals.msWord += printerUsage.totals.msWord;
          existing.totals.simplex += printerUsage.totals.simplex;
          existing.totals.duplex += printerUsage.totals.duplex;
          existing.totals.otherApplication +=
            printerUsage.totals.otherApplication;
          existing.totals.print += printerUsage.totals.print;
        }
      }
    }
  }

  return agg;
}

function downloadBlob(
  filename: string,
  content: string,
  type = 'application/json'
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

type UploadAnalyzeProps = {
  initialPeriods?: ReportPeriod[];
  initialReportName?: string;
  initialUserName?: string;
  initialReportId?: string;
};

function toDate(value?: Date | string) {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function rehydrateReportPeriods(rawPeriods: ReportPeriod[]): ReportPeriod[] {
  return rawPeriods.map((period) => ({
    ...period,
    dateCreated: toDate(period.dateCreated),
    rangeStart: toDate(period.rangeStart),
    rangeEnd: toDate(period.rangeEnd),
    users: Object.fromEntries(
      Object.entries(period.users).map(([userKey, userData]) => [
        userKey,
        {
          totals: { ...userData.totals },
          printerUsage: userData.printerUsage.map((usage) => ({
            ...usage,
            totals: { ...usage.totals },
          })),
        },
      ])
    ),
    grandTotals: { ...period.grandTotals },
  }));
}

export default function UploadAnalyze({
  initialPeriods,
  initialReportName,
  initialUserName,
  initialReportId,
}: UploadAnalyzeProps = {}) {
  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<Set<PeriodKey>>(
    new Set()
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userNameMappings, setUserNameMappings] = useState<
    Record<string, string>
  >({});
  const [tempUserName, setTempUserName] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedPrinters, setSelectedPrinters] = useState<Set<string>>(
    new Set()
  );
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const hydratedFromProps = useRef(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveReportName, setSaveReportName] = useState(initialReportName ?? '');
  const [saveUserName, setSaveUserName] = useState(
    initialUserName?.trim() || DEFAULT_REPORT_OWNER
  );
  const [existingReportId, setExistingReportId] = useState<string | undefined>(
    initialReportId
  );
  const isViewingSavedReport = Boolean(existingReportId);
  const [isSavingReport, setIsSavingReport] = useState(false);
  // Add row selection state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Removed isSaving state

  // Column visibility state
  const [columnVisibility, setColumnVisibility] = useState<
    Record<ColumnKey, boolean>
  >(
    Object.fromEntries(
      AVAILABLE_COLUMNS.map((col) => [col.key, true])
    ) as Record<ColumnKey, boolean>
  );
  // Fix: Declare 'Key' as ColumnKey or import it if it's a distinct type.
  // Assuming 'Key' here refers to 'ColumnKey'.
  const [zeroColumns, setZeroColumns] = useState<Set<ColumnKey>>(new Set());
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [isPrinterMenuOpen, setIsPrinterMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const printerMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        isColumnMenuOpen &&
        columnMenuRef.current &&
        !columnMenuRef.current.contains(target)
      ) {
        setIsColumnMenuOpen(false);
      }
      if (
        isPrinterMenuOpen &&
        printerMenuRef.current &&
        !printerMenuRef.current.contains(target)
      ) {
        setIsPrinterMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsColumnMenuOpen(false);
        setIsPrinterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isColumnMenuOpen, isPrinterMenuOpen]);

  useEffect(() => {
    if (
      initialPeriods &&
      initialPeriods.length > 0 &&
      !hydratedFromProps.current
    ) {
      const revived = rehydrateReportPeriods(initialPeriods);
      setPeriods(revived);
      const derivedName =
        initialReportName ?? revived[0]?.fileName ?? 'Saved report';
      setOriginalFileName(derivedName);
      if (!saveReportName) {
        setSaveReportName(derivedName);
      }
      setSaveUserName(initialUserName?.trim() || DEFAULT_REPORT_OWNER);
      setExistingReportId(initialReportId);
      hydratedFromProps.current = true;
    }
  }, [
    initialPeriods,
    initialReportName,
    initialUserName,
    initialReportId,
    saveReportName,
  ]);
  useEffect(() => {
    if (
      existingReportId &&
      initialReportName &&
      initialReportName !== saveReportName
    ) {
      setSaveReportName(initialReportName);
    }
  }, [existingReportId, initialReportName, saveReportName]);
  const [dragOver, setDragOver] = useState(false);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setErrors(['Please upload only one file at a time.']);
      return;
    }
    setIsParsing(true);
    const newErrors: string[] = [];
    const parsed: ReportPeriod[] = [];
    const file = files[0];
    const trimmedFileName = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
    setOriginalFileName(file.name);
    setSaveReportName(trimmedFileName);
    setExistingReportId(undefined);

    try {
      const text = await file.text();
      const rep = await parseReportHtml(text, file.name);
      parsed.push(rep);
    } catch (e: any) {
      newErrors.push(
        `Failed to parse ${file.name}: ${e?.message ?? String(e)}`
      );
    }

    setErrors(newErrors);
    setPeriods(parsed);
    setIsParsing(false);
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const items = e.dataTransfer?.files;
      await onFiles(items);
    },
    [onFiles]
  );

  const aggregated = useMemo(() => computeAggregated(periods), [periods]);

  const filteredPeriods = useMemo(() => {
    if (selectedPeriodIds.size === 0) {
      return periods;
    }
    return periods.filter((p) => selectedPeriodIds.has(p.id));
  }, [periods, selectedPeriodIds]);

  const selectedUsersAgg = useMemo(
    () => aggregateUsersForSelected(filteredPeriods, selectedPrinters),
    [filteredPeriods, selectedPrinters]
  );

  const visibleColumns = useMemo(() => {
    return AVAILABLE_COLUMNS.filter(
      (col) => columnVisibility[col.key] && !zeroColumns.has(col.key)
    );
  }, [columnVisibility, zeroColumns]);

  const filteredUsers = useMemo<Array<[string, UserData]>>(() => {
    const lowerCaseQuery = userSearchQuery.toLowerCase();
    const result: Array<[string, UserData]> = [];

    aggregated.allUsers.forEach((user) => {
      const displayName = userNameMappings[user] || user;
      if (!displayName.toLowerCase().includes(lowerCaseQuery)) {
        return;
      }

      const userData = selectedUsersAgg[user];
      if (!userData) return;

      result.push([user, userData]);
    });

    return result;
  }, [
    aggregated.allUsers,
    selectedUsersAgg,
    userNameMappings,
    userSearchQuery,
  ]);

  const onExportCsv = useCallback(() => {
    const header = [
      'User',
      'Printers',
      ...visibleColumns.map((col) => col.label),
    ];
    const rows: string[] = [];
    rows.push(header.join(','));

    const rowsToExport =
      selectedRows.size > 0
        ? filteredUsers.filter(([user]) => selectedRows.has(user))
        : filteredUsers;

    for (const [user, userData] of rowsToExport) {
      const printerNames = userData.printerUsage
        .map((p) => formatPrinterName(p.ipHostname))
        .join('; ');
      const rowData = [
        userNameMappings[user] || user,
        printerNames,
        ...visibleColumns.map((col) => userData.totals[col.key].toString()),
      ];
      rows.push(
        rowData.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
      );
    }
    const csv = rows.join('\n');
    const today = new Date().toISOString().split('T')[0];
    const fileName = `IRH Paper Consumption Report - ${today}.csv`;
    downloadBlob(fileName, csv, 'text/csv');
  }, [filteredUsers, userNameMappings, visibleColumns, selectedRows]);

  const onExportPdf = useCallback(() => {
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.text('IRH Paper Consumption Report', 14, 20);
    doc.setFontSize(10);
    if (aggregated.overallRange) {
      doc.text(
        `[${toPrettyDate(aggregated.overallRange.start)} - ${toPrettyDate(
          aggregated.overallRange.end
        )}]`,
        120,
        19
      );
    }

    // Add UNDP logo
    const logoImg = '/UNDP_logo.svg-1.png';
    doc.addImage(logoImg, 'PNG', 185, 10, 15, 30); // x, y, width, height

    doc.setFontSize(12);
    let yPos = 30;

    doc.setFontSize(14);
    doc.text('Print Totals Summary', 14, yPos);
    yPos += 10;
    doc.setFontSize(10);

    const rowsToExport =
      selectedRows.size > 0
        ? filteredUsers.filter(([user]) => selectedRows.has(user))
        : filteredUsers;

    const grandSelectedTotals = rowsToExport.reduce(
      (acc, [, userData]) => {
        const t = userData.totals;
        acc.mono += t.mono;
        acc.color += t.color;
        acc.total += t.total;
        acc.print += t.print;
        return acc;
      },
      {
        mono: 0,
        color: 0,
        total: 0,
        print: 0,
      } as Pick<Totals, 'mono' | 'color' | 'total' | 'print'>
    );

    doc.text(`Users: ${rowsToExport.length}`, 14, yPos);
    doc.text(`Mono: ${grandSelectedTotals.mono}`, 44, yPos);
    doc.text(`Color: ${grandSelectedTotals.color}`, 74, yPos);

    doc.text(`Total Pages: ${grandSelectedTotals.total}`, 104, yPos);

    yPos += 10;
    const tableHeaders = [
      'User',
      'Printers',
      ...visibleColumns.map((col) => col.shortLabel),
    ];
    const tableData = rowsToExport
      .sort((a, b) => b[1].totals.total - a[1].totals.total)
      .map(([user, userData]) => [
        userNameMappings[user] || user,
        userData.printerUsage
          .map((p) => formatPrinterName(p.ipHostname))
          .join(', '),
        ...visibleColumns.map((col) => userData.totals[col.key].toString()),
      ]);

    autoTable(doc, {
      head: [tableHeaders],
      body: tableData,
      startY: yPos,
      styles: {
        fontSize: 9,
        cellPadding: 1,
        lineColor: [210, 210, 210],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [66, 139, 202],
        textColor: 255,
        fontSize: 10,
        halign: 'center',
      },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: {
        0: { cellWidth: 54, fontStyle: 'bold' },
        1: { cellWidth: 28 },
        ...Object.fromEntries(
          visibleColumns.map((_, index) => [
            index + 2,
            { cellWidth: 13, halign: 'right' },
          ])
        ),
      },
      theme: 'grid',
    });

    const fileName = `IRH Paper Consumption Report - ${
      new Date().toISOString().split('T')[0]
    }.pdf`;
    doc.save(fileName);
  }, [
    aggregated,
    filteredUsers,
    visibleColumns,
    userNameMappings,
    selectedRows,
  ]);

  // Add clear row selection callback
  const clearRowSelection = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  // Removed saveReport function and isSaving state
  const clearAll = useCallback(() => {
    setPeriods([]);
    setErrors([]);
    setSelectedPeriodIds(new Set());
    setUserSearchQuery('');
    setSelectedPrinters(new Set());
    clearRowSelection(); // This now works because clearRowSelection is defined above
    if (inputRef.current) inputRef.current.value = '';
    setOriginalFileName(''); // Also clear the original file name
    setSaveReportName('');
    setIsSaveDialogOpen(false);
    setExistingReportId(undefined);
  }, [clearRowSelection]);

  const onTogglePeriod = useCallback((id: PeriodKey) => {
    setSelectedPeriodIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSelectOnly = useCallback((id: PeriodKey) => {
    setSelectedPeriodIds(new Set([id]));
  }, []);

  const onSelectAll = useCallback(() => {
    setSelectedPeriodIds(new Set(aggregated.periods.map((p) => p.id)));
  }, [aggregated.periods]);

  const onClearSelection = useCallback(() => {
    setSelectedPeriodIds(new Set());
  }, []);

  const grandSelectedTotals = useMemo(() => {
    return Object.values(selectedUsersAgg).reduce(
      (acc, userData) => {
        const t = userData.totals;
        acc.mono += t.mono;
        acc.color += t.color;
        acc.blank += t.blank;
        acc.total += t.total;
        acc.adobePdf += t.adobePdf;
        acc.copy += t.copy;
        acc.msExcel += t.msExcel;
        acc.msPowerPoint += t.msPowerPoint;
        acc.msWord += t.msWord;
        acc.simplex += t.simplex;
        acc.duplex += t.duplex;
        acc.otherApplication += t.otherApplication;
        acc.print += t.print;
        return acc;
      },
      {
        mono: 0,
        color: 0,
        blank: 0,
        total: 0,
        adobePdf: 0,
        copy: 0,
        msExcel: 0,
        msPowerPoint: 0,
        msWord: 0,
        simplex: 0,
        duplex: 0,
        otherApplication: 0,
        print: 0,
      } as Totals
    );
  }, [selectedUsersAgg]);

  const getDisplayName = useCallback(
    (originalName: string) => {
      return userNameMappings[originalName] || originalName;
    },
    [userNameMappings]
  );

  const startEditingUser = useCallback(
    (userName: string) => {
      setEditingUser(userName);
      setTempUserName(getDisplayName(userName));
    },
    [getDisplayName]
  );

  const updateUserName = useCallback(() => {
    if (!editingUser) return;
    const trimmed = tempUserName.trim();
    if (!trimmed) {
      setEditingUser(null);
      setTempUserName('');
      return;
    }

    if (trimmed !== editingUser) {
      setPeriods((prevPeriods) =>
        prevPeriods.map((period) => {
          if (!period.users[editingUser]) return period;
          const existingData = period.users[editingUser];
          const updatedUsers = { ...period.users };
          delete updatedUsers[editingUser];

          if (updatedUsers[trimmed]) {
            updatedUsers[trimmed] = mergeUserData(
              updatedUsers[trimmed],
              existingData
            );
          } else {
            updatedUsers[trimmed] = existingData;
          }

          return { ...period, users: updatedUsers };
        })
      );

      setSelectedRows((prev) => {
        if (!prev.has(editingUser)) return prev;
        const next = new Set(prev);
        next.delete(editingUser);
        next.add(trimmed);
        return next;
      });
    }

    setUserNameMappings((prev) => {
      const next = { ...prev };
      delete next[editingUser];
      next[trimmed] = trimmed;
      return next;
    });

    setEditingUser(null);
    setTempUserName('');
  }, [editingUser, tempUserName]);

  const cancelEditingUser = useCallback(() => {
    setEditingUser(null);
    setTempUserName('');
  }, []);

  // Add toggle row selection callback
  const toggleRowSelection = useCallback((user: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(user)) {
        next.delete(user);
      } else {
        next.add(user);
      }
      return next;
    });
  }, []);

  // Add select all rows callback
  const selectAllRows = useCallback(() => {
    setSelectedRows(new Set(filteredUsers.map(([user]) => user)));
  }, [filteredUsers]);

  // Add delete selected rows callback
  const deleteSelectedRows = useCallback(() => {
    setPeriods((prevPeriods) =>
      prevPeriods.map((period) => {
        const updatedUsers = { ...period.users };
        for (const user of selectedRows) {
          delete updatedUsers[user];
        }
        return { ...period, users: updatedUsers };
      })
    );
    setSelectedRows(new Set());
    setShowDeleteConfirm(false);
  }, [selectedRows]);

  // Removed saveReport function

  // Column visibility handlers
  const showAllColumns = useCallback(() => {
    setColumnVisibility(
      Object.fromEntries(AVAILABLE_COLUMNS.map((col) => [col.key, true])) as Record<
        ColumnKey,
        boolean
      >
    );
    setZeroColumns(new Set());
  }, []);

  const hideZeroColumns = useCallback(() => {
    const currentZeroColumns: Set<ColumnKey> = new Set();
    const newColumnVisibility = { ...columnVisibility };

    for (const col of AVAILABLE_COLUMNS) {
      let allZeros = filteredPeriods.length > 0;

      if (allZeros) {
        for (const period of filteredPeriods) {
          for (const userKey in period.users) {
            if (period.users[userKey].totals[col.key] > 0) {
              allZeros = false;
              break;
            }
          }
          if (!allZeros) break;
        }
      }

      if (allZeros) {
        currentZeroColumns.add(col.key);
        newColumnVisibility[col.key] = false;
      }
    }
    setZeroColumns(currentZeroColumns);
    setColumnVisibility(newColumnVisibility);
  }, [columnVisibility, filteredPeriods]);

  const toggleColumnVisibility = useCallback((key: ColumnKey) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Printer filter handlers
  const togglePrinterFilter = useCallback((printer: string) => {
    setSelectedPrinters((prev) => {
      const next = new Set(prev);
      if (next.has(printer)) {
        next.delete(printer);
      } else {
        next.add(printer);
      }
      return next;
    });
  }, []);

  const allPrinters = aggregated.allPrinters; // Renamed from allPrinters to allPrinters for clarity
  const selectAllPrinters = useCallback(() => {
    setSelectedPrinters(new Set(allPrinters));
  }, [allPrinters]);
  const clearPrinterSelection = useCallback(() => {
    setSelectedPrinters(new Set());
  }, []);
  const handleOpenSaveDialog = useCallback(() => {
    if (!saveReportName) {
      setSaveReportName(
        originalFileName || initialReportName || 'Untitled report'
      );
    }
    setIsSaveDialogOpen(true);
  }, [initialReportName, originalFileName, saveReportName]);

  const canSaveReport = saveReportName.trim().length > 0 && periods.length > 0;

  const saveReport = useCallback(
    async (targetReportId?: string) => {
      if (!canSaveReport) return;
      const payload = {
        reportName: saveReportName.trim(),
        userName: saveUserName.trim(),
        periods,
      };
      setIsSavingReport(true);
      const isUpdate = Boolean(targetReportId);
      try {
        const response = await fetch(
          isUpdate ? `/api/reports/${targetReportId}` : '/api/reports',
          {
            method: isUpdate ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(
            data?.error ||
              (isUpdate ? 'Failed to update report' : 'Failed to save report')
          );
        }
        setIsSaveDialogOpen(false);
        if (typeof window !== 'undefined') {
          window.alert(
            isUpdate
              ? 'Report updated successfully.'
              : 'Report saved successfully.'
          );
        }
      } catch (error) {
        console.error('Failed to save report', error);
        if (typeof window !== 'undefined') {
          const message =
            error instanceof Error && error.message
              ? error.message
              : 'Failed to save report. Please try again.';
          window.alert(message);
        }
      } finally {
        setIsSavingReport(false);
      }
    },
    [canSaveReport, periods, saveReportName, saveUserName]
  );

  const handleSaveButtonClick = useCallback(() => {
    if (existingReportId) {
      saveReport(existingReportId);
    } else {
      handleOpenSaveDialog();
    }
  }, [existingReportId, handleOpenSaveDialog, saveReport]);

  return (
    <div>
      {!isViewingSavedReport && (
        <div
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border border-dashed p-8 transition-colors',
            dragOver
              ? 'border-emerald-500 bg-emerald-50/50'
              : 'border-muted-foreground/20'
          )}
          role='region'
          aria-label='Upload zone'
        >
          {!originalFileName && (
            <>
              <UploadCloud
                className={cn(
                  'mb-3 h-8 w-8',
                  dragOver ? 'text-emerald-600' : 'text-muted-foreground'
                )}
                aria-hidden
              />

              <p className='mb-2 text-sm'>
                Drag & drop your HP Web Jetadmin HTML report here
              </p>
              <p className='mb-4 text-xs text-muted-foreground'>
                We process files in-browser. No data leaves your device.
              </p>
            </>
          )}
          <div className='flex items-center gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='file-input' className='sr-only'>
                Select HTML file
              </Label>
              <input
                ref={inputRef}
                id='file-input'
                type='file'
                accept='.html,.htm,text/html'
                onChange={(e) => onFiles(e.currentTarget.files)}
                className='sr-only'
              />
              <Button
                type='button'
                variant='outline'
                className={cn(
                  'flex min-w-64 items-center gap-2 text-sm',
                  originalFileName
                    ? 'justify-start text-left'
                    : 'justify-center'
                )}
                onClick={() => inputRef.current?.click()}
              >
                {originalFileName ? (
                  <>
                    <FileText className='h-4 w-4 shrink-0' aria-hidden />
                    <span className='flex-1'>{originalFileName}</span>
                  </>
                ) : (
                  <>
                    <FileUp className='h-4 w-4 shrink-0' aria-hidden />
                    Browse
                  </>
                )}
              </Button>
            </div>
            {periods.length > 0 && (
              <Button variant='ghost' onClick={clearAll}>
                <Trash2 className='mr-2 h-4 w-4' /> Clear
              </Button>
            )}
          </div>
          {isParsing && (
            <div className='mt-3 inline-flex items-center text-sm text-muted-foreground'>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Parsing...
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <Alert variant='destructive' className='mt-4'>
          <AlertTitle>Some files could not be parsed</AlertTitle>
          <AlertDescription>
            <ul className='list-disc pl-5'>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {aggregated.periods.length > 0 && (
        <div className='mt-6 space-y-6'>
          <div className='grid gap-4 grid-cols-3'>
            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-sm font-medium'>
                  Overall date range
                </CardTitle>
              </CardHeader>
              <CardContent className='text-sm'>
                {aggregated.overallRange ? (
                  <span>
                    {toPrettyDate(aggregated.overallRange.start)} —{' '}
                    {toPrettyDate(aggregated.overallRange.end)}
                  </span>
                ) : (
                  <span>Unknown</span>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-sm font-medium'>
                  Users detected
                </CardTitle>
              </CardHeader>
              <CardContent className='text-2xl font-semibold'>
                {aggregated.allUsers.length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-sm font-medium'>
                  Print totals
                </CardTitle>
              </CardHeader>
              <CardContent className='text-sm'>
                <div className='flex flex-wrap gap-1'>
                  <Badge variant='secondary'>
                    Mono: {grandSelectedTotals.mono}
                  </Badge>
                  <Badge variant='secondary'>
                    Color: {grandSelectedTotals.color}
                  </Badge>
                  <Badge variant='default'>
                    Total: {grandSelectedTotals.total}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className='pb-2'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-base'>Usage</CardTitle>
                <div className='flex gap-2'>
                  {selectedRows.size > 0 && (
                    <>
                      <Badge variant='secondary' className='mr-2'>
                        {selectedRows.size} selected
                      </Badge>
                      <Button
                        size='sm'
                        variant='destructive'
                        onClick={() => setShowDeleteConfirm(true)}
                      >
                        <Trash2 className='mr-2 h-3.5 w-3.5' /> Delete Selected
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={clearRowSelection}
                      >
                        Clear Selection
                      </Button>
                    </>
                  )}

                  <div className='relative' ref={columnMenuRef}>
                    <Button
                      size='sm'
                      variant='outline'
                      aria-haspopup='true'
                      aria-expanded={isColumnMenuOpen}
                      onClick={() => {
                        setIsPrinterMenuOpen(false);
                        setIsColumnMenuOpen((prevOpen) => !prevOpen);
                      }}
                    >
                      <Settings className='mr-2 h-3.5 w-3.5' /> Columns
                    </Button>
                    {isColumnMenuOpen && (
                      <div
                        role='menu'
                        className='absolute right-0 z-20 mt-2 w-80 rounded-md border bg-popover p-4 text-popover-foreground shadow-md'
                      >
                        <div className='space-y-4'>
                          <div>
                            <h4 className='text-sm font-semibold'>
                              Column Visibility
                            </h4>
                            <p className='text-xs text-muted-foreground'>
                              Toggle which usage columns are displayed. Columns
                              with only zero values are auto-hidden.
                            </p>
                          </div>
                          <div className='flex gap-2'>
                            <Button
                              size='sm'
                              variant='outline'
                              className='flex-1'
                              onClick={showAllColumns}
                            >
                              Show All
                            </Button>
                            <Button
                              size='sm'
                              variant='outline'
                              className='flex-1'
                              onClick={hideZeroColumns}
                            >
                              Hide Zeros
                            </Button>
                          </div>
                          <div className='space-y-2 max-h-60 overflow-y-auto pr-2'>
                            {AVAILABLE_COLUMNS.map((col) => {
                              const isZero = zeroColumns.has(col.key);
                              const isVisible = columnVisibility[col.key];
                              return (
                                <div
                                  key={col.key}
                                  className='flex items-center space-x-2 rounded-md border border-border/60 p-2'
                                >
                                  <Checkbox
                                    id={`col-${col.key}`}
                                    checked={isVisible && !isZero}
                                    onCheckedChange={() =>
                                      toggleColumnVisibility(col.key)
                                    }
                                    disabled={isZero}
                                  />
                                  <label
                                    htmlFor={`col-${col.key}`}
                                    className={cn(
                                      'text-sm font-medium leading-none',
                                      isZero &&
                                        'text-muted-foreground line-through'
                                    )}
                                  >
                                    {col.label}
                                    {isZero && ' (all zeros)'}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <Button size='sm' variant='outline' onClick={onExportCsv}>
                    <Download className='mr-2 h-3.5 w-3.5' /> Export CSV
                    {selectedRows.size > 0 && ` (${selectedRows.size})`}
                  </Button>
                  <Button size='sm' variant='outline' onClick={onExportPdf}>
                    <Download className='mr-2 h-3.5 w-3.5' /> Export PDF
                    {selectedRows.size > 0 && ` (${selectedRows.size})`}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={handleSaveButtonClick}
                    disabled={periods.length === 0 || isSavingReport}
                    className='bg-green-700  text-white border-emerald-600'
                  >
                    {isSavingReport && (
                      <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                    )}
                    {existingReportId ? 'Save Changes' : 'Save'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className='mb-4 flex flex-wrap items-center gap-3'>
                <div className='flex-1 min-w-50'>
                  <Label htmlFor='user-search' className='sr-only'>
                    Search users
                  </Label>
                  <Input
                    id='user-search'
                    type='text'
                    placeholder='Search users...'
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className='w-full'
                  />
                </div>
                <div className='relative' ref={printerMenuRef}>
                  <Button
                    variant='outline'
                    size='sm'
                    aria-haspopup='true'
                    aria-expanded={isPrinterMenuOpen}
                    onClick={() => {
                      setIsColumnMenuOpen(false);
                      setIsPrinterMenuOpen((prevOpen) => !prevOpen);
                    }}
                  >
                    <Filter className='mr-2 h-4 w-4' />
                    Printers{' '}
                    {selectedPrinters.size > 0 && `(${selectedPrinters.size})`}
                  </Button>
                  {isPrinterMenuOpen && (
                    <div
                      role='menu'
                      className='absolute right-0 z-20 mt-2 w-80 rounded-md border bg-popover p-4 text-popover-foreground shadow-md'
                    >
                      <div className='space-y-4'>
                        <div>
                          <h4 className='text-sm font-semibold'>
                            Filter by Printer
                          </h4>
                          <p className='text-xs text-muted-foreground'>
                            Select one or more printers to focus the usage data.
                          </p>
                        </div>
                        <div className='flex gap-2'>
                          <Button
                            size='sm'
                            variant='outline'
                            className='flex-1'
                            onClick={selectAllPrinters}
                          >
                            Select All
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            className='flex-1'
                            onClick={clearPrinterSelection}
                          >
                            Clear
                          </Button>
                        </div>
                        <div className='space-y-2 max-h-60 overflow-y-auto pr-2'>
                          {allPrinters.length === 0 && (
                            <p className='text-sm text-muted-foreground'>
                              No printers detected yet.
                            </p>
                          )}
                          {allPrinters.map((printer) => (
                            <div
                              key={printer}
                              className='flex items-center space-x-2 rounded-md border border-border/60 p-2'
                            >
                              <Checkbox
                                id={`printer-${printer}`}
                                checked={selectedPrinters.has(printer)}
                                onCheckedChange={() =>
                                  togglePrinterFilter(printer)
                                }
                              />
                              <label
                                htmlFor={`printer-${printer}`}
                                className='text-sm font-medium leading-none'
                              >
                                <span
                                  className='block truncate'
                                  title={printer}
                                >
                                  {formatPrinterName(printer)} ({printer})
                                </span>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <ScrollArea className='w-full'>
                <div className='overflow-x-auto'>
                  <div className='min-w-max'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-12'>
                            <Checkbox
                              checked={
                                selectedRows.size === filteredUsers.length &&
                                filteredUsers.length > 0
                              }
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  selectAllRows();
                                } else {
                                  clearRowSelection();
                                }
                              }}
                            />
                          </TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Printers</TableHead>
                          {visibleColumns.map((col) => (
                            <TableHead key={col.key} className='text-right'>
                              {col.label}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={visibleColumns.length + 3}
                              className='text-center text-muted-foreground'
                            >
                              No users found. Try adjusting your search or
                              filters.
                            </TableCell>
                          </TableRow>
                        )}
                        {filteredUsers
                          .sort((a, b) => b[1].totals.total - a[1].totals.total)
                          .map(([user, userData]) => (
                            <TableRow key={user}>
                              <TableCell className='w-12'>
                                <Checkbox
                                  checked={selectedRows.has(user)}
                                  onCheckedChange={() =>
                                    toggleRowSelection(user)
                                  }
                                />
                              </TableCell>
                              <TableCell className='font-medium'>
                                {editingUser === user ? (
                                  <div className='flex items-center gap-2'>
                                    <Input
                                      value={tempUserName}
                                      onChange={(e) =>
                                        setTempUserName(e.target.value)
                                      }
                                      className='h-8 text-sm'
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') updateUserName();
                                        if (e.key === 'Escape')
                                          cancelEditingUser();
                                      }}
                                      autoFocus
                                    />
                                    <Button
                                      size='sm'
                                      variant='ghost'
                                      onClick={updateUserName}
                                    >
                                      ✓
                                    </Button>
                                    <Button
                                      size='sm'
                                      variant='ghost'
                                      onClick={cancelEditingUser}
                                    >
                                      ✕
                                    </Button>
                                  </div>
                                ) : (
                                  <div className='flex items-center justify-between group'>
                                    <span>{getDisplayName(user)}</span>
                                    <Button
                                      size='sm'
                                      variant='ghost'
                                      className='opacity-0 group-hover:opacity-100 h-6 w-6 p-0'
                                      onClick={() => startEditingUser(user)}
                                    >
                                      <Pencil className='h-4 w-4' />
                                    </Button>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className='text-sm'>
                                <div className='flex flex-wrap gap-1'>
                                  {userData.printerUsage.map(
                                    (printerUsage: PrinterUsage, idx: number) => (
                                      <Badge
                                        key={idx}
                                        variant='secondary'
                                        className='text-xs'
                                        title={printerUsage.ipHostname}
                                      >
                                        {formatPrinterName(
                                          printerUsage.ipHostname
                                        )}
                                      </Badge>
                                    )
                                  )}
                                </div>
                              </TableCell>
                              {visibleColumns.map((col) => (
                                <TableCell
                                  key={col.key}
                                  className={cn(
                                    'text-right',
                                    col.key === 'total' && 'font-semibold'
                                  )}
                                >
                                  {userData.totals[col.key]}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedRows.size} user record
              {selectedRows.size !== 1 ? 's' : ''} from all periods. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSelectedRows}
              className='bg-destructive text-white hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save report</DialogTitle>
            <DialogDescription>
              Store the current usage snapshot grouped by user name.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-1'>
              <Label htmlFor='save-report-name'>Report name</Label>
              <Input
                id='save-report-name'
                value={saveReportName}
                onChange={(e) => setSaveReportName(e.target.value)}
                placeholder='Quarterly usage report'
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => setIsSaveDialogOpen(false)}
              disabled={isSavingReport}
            >
              Cancel
            </Button>
            <Button
              type='button'
              onClick={() => saveReport()}
              disabled={!canSaveReport || isSavingReport}
            >
              {isSavingReport && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Save Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
