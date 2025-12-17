'use client';
import { useCallback, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Download, Filter, Search, Settings, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import { cn } from '@/lib/utils';
import type {
  ReportPeriod,
  UserData,
  Totals,
  PeriodKey,
  UserKey,
} from '@/lib/report-types';

type ColumnKey = keyof Omit<Totals, 'blank' | 'print'>;

type ColumnConfig = {
  key: ColumnKey;
  label: string;
  shortLabel: string;
};

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

function toPrettyDate(d?: Date): string {
  if (!d) return 'Unknown';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-UK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPrinterName(printerName: string): string {
  const numberLetterMatch = printerName.match(/(\d+)([A-Z])$/i);
  if (numberLetterMatch) {
    return `${numberLetterMatch[1]}${numberLetterMatch[2].toUpperCase()}`;
  }
  const underscoreMatch = printerName.match(/(\d+)_([A-Z])$/i);
  if (underscoreMatch) {
    return `${underscoreMatch[1]}${underscoreMatch[2].toUpperCase()}`;
  }
  return printerName.length <= 4
    ? printerName.toUpperCase()
    : printerName.substring(0, 4).toUpperCase();
}

type Aggregated = {
  periods: ReportPeriod[];
  overallRange?: { start: Date; end: Date };
  allUsers: UserKey[];
  allPrinters: string[];
};

function computeAggregated(periods: ReportPeriod[]): Aggregated {
  const sorted = [...periods].sort((a, b) => {
    const ad = a.rangeStart
      ? new Date(a.rangeStart).getTime()
      : a.dateCreated
      ? new Date(a.dateCreated).getTime()
      : 0;
    const bd = b.rangeStart
      ? new Date(b.rangeStart).getTime()
      : b.dateCreated
      ? new Date(b.dateCreated).getTime()
      : 0;
    return ad - bd;
  });

  let overallStart: Date | undefined;
  let overallEnd: Date | undefined;
  for (const p of sorted) {
    const rangeStart = p.rangeStart ? new Date(p.rangeStart) : undefined;
    const rangeEnd = p.rangeEnd ? new Date(p.rangeEnd) : undefined;
    if (rangeStart && (!overallStart || rangeStart < overallStart))
      overallStart = rangeStart;
    if (rangeEnd && (!overallEnd || rangeEnd > overallEnd))
      overallEnd = rangeEnd;
  }

  const allUsers = Array.from(
    new Set(sorted.flatMap((p) => Object.keys(p.users)))
  ).sort((a, b) => a.localeCompare(b));
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
      const relevantPrinterUsage =
        selectedPrinters && selectedPrinters.size > 0
          ? userData.printerUsage.filter((pu) =>
              selectedPrinters.has(pu.ipHostname)
            )
          : userData.printerUsage;

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

      for (const printerUsage of relevantPrinterUsage) {
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

        const exists = userAgg.printerUsage.some(
          (p) =>
            p.ipHostname === printerUsage.ipHostname &&
            p.ipAddress === printerUsage.ipAddress
        );
        if (!exists) {
          userAgg.printerUsage.push({ ...printerUsage });
        } else {
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

type ReportViewerProps = {
  initialPeriods: ReportPeriod[];
};

export default function ReportViewer({ initialPeriods }: ReportViewerProps) {
  const [periods] = useState<ReportPeriod[]>(initialPeriods);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<Set<PeriodKey>>(
    new Set()
  );
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedPrinters, setSelectedPrinters] = useState<Set<string>>(
    new Set()
  );
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [columnVisibility, setColumnVisibility] = useState<
    Record<ColumnKey, boolean>
  >(() => {
    const initial: Record<ColumnKey, boolean> = {} as Record<
      ColumnKey,
      boolean
    >;
    AVAILABLE_COLUMNS.forEach((col) => {
      initial[col.key] = true;
    });
    return initial;
  });

  const aggregated = useMemo(() => computeAggregated(periods), [periods]);

  const selectedPeriods = useMemo(
    () =>
      aggregated.periods.filter(
        (p) => selectedPeriodIds.size === 0 || selectedPeriodIds.has(p.id)
      ),
    [aggregated.periods, selectedPeriodIds]
  );

  const selectedUsersAgg = useMemo(
    () => aggregateUsersForSelected(selectedPeriods, selectedPrinters),
    [selectedPeriods, selectedPrinters]
  );

  const getZeroColumns = useCallback(
    (data: Record<string, UserData>): Set<ColumnKey> => {
      const zeroColumns = new Set<ColumnKey>();
      AVAILABLE_COLUMNS.forEach((col) => {
        const hasNonZeroValue = Object.values(data).some(
          (userData) => userData.totals[col.key] > 0
        );
        if (!hasNonZeroValue) {
          zeroColumns.add(col.key);
        }
      });
      return zeroColumns;
    },
    []
  );

  const zeroColumns = useMemo(
    () => getZeroColumns(selectedUsersAgg),
    [selectedUsersAgg, getZeroColumns]
  );

  const filteredUsers = useMemo(() => {
    let list = Object.keys(selectedUsersAgg);
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase();
      list = list.filter((u) => u.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.localeCompare(b));
  }, [selectedUsersAgg, userSearchQuery]);

  const visibleColumns = useMemo(
    () =>
      AVAILABLE_COLUMNS.filter(
        (col) => columnVisibility[col.key] && !zeroColumns.has(col.key)
      ),
    [columnVisibility, zeroColumns]
  );

  const onTogglePeriod = useCallback(
    (id: PeriodKey, isShift: boolean) => {
      setSelectedPeriodIds((prev) => {
        const next = new Set(prev);
        if (prev.size === 0) {
          next.add(id);
        } else if (isShift && prev.size === 1) {
          const [firstId] = Array.from(prev);
          const firstIdx = aggregated.periods.findIndex(
            (p) => p.id === firstId
          );
          const clickedIdx = aggregated.periods.findIndex((p) => p.id === id);
          const [start, end] =
            firstIdx < clickedIdx
              ? [firstIdx, clickedIdx]
              : [clickedIdx, firstIdx];
          for (let i = start; i <= end; i++) {
            next.add(aggregated.periods[i].id);
          }
        } else {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    [aggregated.periods]
  );

  const toggleColumnVisibility = useCallback((key: ColumnKey) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const showAllColumns = useCallback(() => {
    setColumnVisibility((prev) => {
      const updated = { ...prev };
      AVAILABLE_COLUMNS.forEach((col) => {
        updated[col.key] = true;
      });
      return updated;
    });
  }, []);

  const hideZeroColumns = useCallback(() => {
    setColumnVisibility((prev) => {
      const updated = { ...prev };
      AVAILABLE_COLUMNS.forEach((col) => {
        if (zeroColumns.has(col.key)) {
          updated[col.key] = false;
        }
      });
      return updated;
    });
  }, [zeroColumns]);

  const clearRowSelection = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  const selectAllRows = useCallback(() => {
    setSelectedRows(new Set(filteredUsers));
  }, [filteredUsers]);

  const deleteSelectedRows = useCallback(() => {
    alert('Delete functionality not available in saved reports view');
    setShowDeleteConfirm(false);
    setSelectedRows(new Set());
  }, []);

  const exportToCSV = useCallback(() => {
    try {
      const dataToExport =
        selectedRows.size > 0
          ? filteredUsers.filter((u) => selectedRows.has(u))
          : filteredUsers;

      if (dataToExport.length === 0) {
        alert('No data to export');
        return;
      }

      const headers = [
        'User',
        ...visibleColumns.map((c) => c.label),
        'Printers',
      ];
      const rows = dataToExport.map((user) => {
        const userData = selectedUsersAgg[user];
        const printerNames =
          selectedPrinters.size > 0
            ? userData.printerUsage
                .filter((pu) => selectedPrinters.has(pu.ipHostname))
                .map((pu) => formatPrinterName(pu.ipHostname))
                .join(', ')
            : userData.printerUsage
                .map((pu) => formatPrinterName(pu.ipHostname))
                .join(', ');

        return [
          user,
          ...visibleColumns.map((c) => userData.totals[c.key]),
          printerNames,
        ];
      });

      const csvContent = [headers, ...rows]
        .map((row) => row.map((cell) => `"${cell}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `report-export-${
        selectedRows.size > 0 ? 'selected' : 'all'
      }-${timestamp}.csv`;

      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      console.log(
        `[v0] CSV export successful: ${dataToExport.length} rows exported to ${filename}`
      );
      alert(`Successfully exported ${dataToExport.length} rows to ${filename}`);
    } catch (error) {
      console.error('[v0] CSV export failed:', error);
      alert('Failed to export CSV. Please try again.');
    }
  }, [
    selectedRows,
    filteredUsers,
    selectedUsersAgg,
    visibleColumns,
    selectedPrinters,
  ]);

  const exportToPDF = useCallback(() => {
    const dataToExport =
      selectedRows.size > 0
        ? filteredUsers.filter((u) => selectedRows.has(u))
        : filteredUsers;

    if (dataToExport.length === 0) {
      alert('No data to export');
      return;
    }

    const doc = new jsPDF();
    doc.text('Usage Report', 14, 15);

    const headers = [
      ['User', ...visibleColumns.map((c) => c.shortLabel), 'Printers'],
    ];
    const rows = dataToExport.map((user) => {
      const userData = selectedUsersAgg[user];
      const printerNames =
        selectedPrinters.size > 0
          ? userData.printerUsage
              .filter((pu) => selectedPrinters.has(pu.ipHostname))
              .map((pu) => formatPrinterName(pu.ipHostname))
              .join(', ')
          : userData.printerUsage
              .map((pu) => formatPrinterName(pu.ipHostname))
              .join(', ');

      return [
        user,
        ...visibleColumns.map((c) => userData.totals[c.key].toString()),
        printerNames,
      ];
    });

    autoTable(doc, {
      head: headers,
      body: rows,
      startY: 20,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [34, 197, 94] },
    });

    doc.save(`report-export-${selectedRows.size > 0 ? 'selected' : 'all'}.pdf`);
  }, [
    selectedRows,
    filteredUsers,
    selectedUsersAgg,
    visibleColumns,
    selectedPrinters,
  ]);

  const toggleRowSelection = useCallback((user: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(user)) next.delete(user);
      else next.add(user);
      return next;
    });
  }, []);

  if (periods.length === 0) {
    return (
      <Alert>
        <AlertTitle>No data</AlertTitle>
        <AlertDescription>
          This report contains no data to display.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className='grid gap-4 md:grid-cols-3 mb-6'>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-muted-foreground'>
              Overall Date Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-xl font-semibold'>
              {aggregated.overallRange ? (
                <>
                  {toPrettyDate(aggregated.overallRange.start)} —{' '}
                  {toPrettyDate(aggregated.overallRange.end)}
                </>
              ) : (
                'N/A'
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-muted-foreground'>
              Users Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-xl font-semibold'>
              {aggregated.allUsers.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-muted-foreground'>
              Print Totals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex gap-3 text-sm'>
              <div>
                <span className='font-semibold'>
                  {selectedPeriods
                    .reduce((sum, p) => sum + p.grandTotals.mono, 0)
                    .toLocaleString()}
                </span>{' '}
                Mono
              </div>
              <div>
                <span className='font-semibold'>
                  {selectedPeriods
                    .reduce((sum, p) => sum + p.grandTotals.color, 0)
                    .toLocaleString()}
                </span>{' '}
                Color
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className='mb-6'>
        <Card className='max-w-full'>
          <CardHeader className='pb-2'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-sm font-medium text-muted-foreground'>
                Periods ({aggregated.periods.length} file(s) uploaded)
              </CardTitle>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => setSelectedPeriodIds(new Set())}
                disabled={selectedPeriodIds.size === 0}
              >
                Select all
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className='w-full'>
              <div className='flex flex-wrap gap-2'>
                {aggregated.periods.map((p) => {
                  const selected =
                    selectedPeriodIds.size === 0
                      ? false
                      : selectedPeriodIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type='button'
                      onClick={(e) => onTogglePeriod(p.id, e.shiftKey)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs transition-colors',
                        selected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-muted-foreground/20 hover:bg-muted'
                      )}
                      title={`${p.fileName}\nCreated: ${toPrettyDate(
                        p.dateCreated
                      )}\nRange: ${toPrettyDate(p.rangeStart)} — ${toPrettyDate(
                        p.rangeEnd
                      )}`}
                    >
                      {p.periodLabel}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue='users'>
        <TabsList>
          <TabsTrigger value='users'>Users</TabsTrigger>
        </TabsList>
        <TabsContent value='users' className='mt-4'>
          <Card>
            <CardHeader className='pb-2'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-base'>
                  Per-user totals{' '}
                  {selectedPeriodIds.size > 0
                    ? '(selected periods)'
                    : '(all periods)'}
                </CardTitle>
                <div className='flex gap-2'>
                  {selectedRows.size > 0 && (
                    <>
                      <Badge variant='secondary' className='mr-2'>
                        {selectedRows.size} selected
                      </Badge>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={clearRowSelection}
                      >
                        Clear Selection
                      </Button>
                    </>
                  )}
                  {selectedRows.size === 0 && (
                    <Button size='sm' variant='outline' onClick={selectAllRows}>
                      Select All
                    </Button>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size='sm' variant='outline'>
                        <Settings className='mr-2 h-3.5 w-3.5' /> Columns
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-80'>
                      <div className='space-y-4'>
                        <div className='space-y-2'>
                          <h4 className='font-medium leading-none'>
                            Column Visibility
                          </h4>
                          <p className='text-sm text-muted-foreground'>
                            Choose which columns to display. Zero-value columns
                            are automatically hidden.
                          </p>
                        </div>
                        <div className='space-y-2'>
                          <div className='flex gap-2'>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={showAllColumns}
                            >
                              Show All
                            </Button>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={hideZeroColumns}
                            >
                              Hide Zeros
                            </Button>
                          </div>
                        </div>
                        <div className='space-y-2 max-h-60 overflow-y-auto'>
                          {AVAILABLE_COLUMNS.map((col) => {
                            const isZero = zeroColumns.has(col.key);
                            const isVisible = columnVisibility[col.key];
                            return (
                              <div
                                key={col.key}
                                className='flex items-center space-x-2'
                              >
                                <Checkbox
                                  id={col.key}
                                  checked={isVisible && !isZero}
                                  disabled={isZero}
                                  onCheckedChange={() =>
                                    toggleColumnVisibility(col.key)
                                  }
                                />
                                <label
                                  htmlFor={col.key}
                                  className={cn(
                                    'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
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
                    </PopoverContent>
                  </Popover>
                  <Button size='sm' variant='outline' onClick={exportToCSV}>
                    <Download className='mr-2 h-3.5 w-3.5' /> Export CSV
                  </Button>
                  <Button size='sm' variant='outline' onClick={exportToPDF}>
                    <Download className='mr-2 h-3.5 w-3.5' /> Export PDF
                  </Button>
                </div>
              </div>
              <div className='flex gap-2 mt-2'>
                <div className='relative flex-1'>
                  <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
                  <Input
                    placeholder='Search users...'
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.currentTarget.value)}
                    className='pl-8'
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size='sm' variant='outline'>
                      <Filter className='mr-2 h-3.5 w-3.5' /> Printers
                      {selectedPrinters.size > 0 && (
                        <Badge variant='secondary' className='ml-2'>
                          {selectedPrinters.size}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className='w-80'>
                    <div className='space-y-4'>
                      <div className='flex items-center justify-between'>
                        <h4 className='font-medium leading-none'>
                          Filter by Printer
                        </h4>
                        {selectedPrinters.size > 0 && (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => setSelectedPrinters(new Set())}
                          >
                            <X className='h-3.5 w-3.5' />
                          </Button>
                        )}
                      </div>
                      <ScrollArea className='h-60'>
                        <div className='space-y-2'>
                          {aggregated.allPrinters.map((printer) => (
                            <div
                              key={printer}
                              className='flex items-center space-x-2'
                            >
                              <Checkbox
                                id={`printer-${printer}`}
                                checked={selectedPrinters.has(printer)}
                                onCheckedChange={() => {
                                  setSelectedPrinters((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(printer)) next.delete(printer);
                                    else next.add(printer);
                                    return next;
                                  });
                                }}
                              />
                              <label
                                htmlFor={`printer-${printer}`}
                                className='text-sm font-medium leading-none'
                              >
                                {formatPrinterName(printer)} ({printer})
                              </label>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </CardHeader>
            <CardContent>
              <div className='rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-12'>
                        <span className='sr-only'>Select</span>
                      </TableHead>
                      <TableHead>User</TableHead>
                      {visibleColumns.map((col) => (
                        <TableHead key={col.key} className='text-right'>
                          {col.shortLabel}
                        </TableHead>
                      ))}
                      <TableHead>Printers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={visibleColumns.length + 3}
                          className='text-center text-muted-foreground'
                        >
                          No users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUsers.map((user) => {
                        const userData = selectedUsersAgg[user];
                        const isSelected = selectedRows.has(user);
                        const printerBadges =
                          selectedPrinters.size > 0
                            ? userData.printerUsage.filter((pu) =>
                                selectedPrinters.has(pu.ipHostname)
                              )
                            : userData.printerUsage;

                        return (
                          <TableRow key={user}>
                            <TableCell>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRowSelection(user)}
                              />
                            </TableCell>
                            <TableCell className='font-medium'>
                              {user}
                            </TableCell>
                            {visibleColumns.map((col) => (
                              <TableCell key={col.key} className='text-right'>
                                {userData.totals[col.key].toLocaleString()}
                              </TableCell>
                            ))}
                            <TableCell>
                              <div className='flex flex-wrap gap-1'>
                                {printerBadges.map((pu, idx) => (
                                  <Badge
                                    key={idx}
                                    variant='outline'
                                    className='text-xs'
                                  >
                                    {formatPrinterName(pu.ipHostname)}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected rows?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {selectedRows.size} user
              {selectedRows.size > 1 ? 's' : ''} from the current view. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSelectedRows}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
