'use client';

import { type FormEvent, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Trash2, FileText, ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import UploadAnalyze from '@/components/upload-analyze';
import type { ReportPeriod } from '@/lib/report-types';
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

type ReportSummary = {
  id: string;
  reportName: string;
  userName: string;
  createdAt: string;
  fileCount: number;
};

type GroupedReports = Record<string, ReportSummary[]>;

export default function SavedReportsPage() {
  const [reports, setReports] = useState<GroupedReports>({});
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<{
    id: string;
    name: string;
    userName: string;
    periods: ReportPeriod[];
  } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [pendingReportName, setPendingReportName] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const loadReports = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/reports');
      const data = await response.json();
      if (data.success) {
        setReports(data.reports);
      }
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);
  useEffect(() => {
    if (selectedReport) {
      setPendingReportName(selectedReport.name);
      setIsRenaming(false);
      setRenameSaving(false);
    }
  }, [selectedReport]);

  const loadReport = async (summary: ReportSummary) => {
    try {
      const response = await fetch(`/api/reports/${summary.id}`);
      const data = await response.json();
      if (data.success) {
        setSelectedReport({
          id: summary.id,
          name: summary.reportName,
          userName: summary.userName,
          periods: data.report.periods,
        });
      }
    } catch (error) {
      console.error('Failed to load report:', error);
      alert('Failed to load report');
    }
  };

  const deleteReport = async (id: string) => {
    try {
      const response = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        setDeleteConfirm(null);
        await loadReports();
      } else {
        alert('Failed to delete report');
      }
    } catch (error) {
      console.error('Failed to delete report:', error);
      alert('Failed to delete report');
    }
  };

  const handleRenameSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!selectedReport) return;
    const trimmed = pendingReportName.trim();
    if (!trimmed || trimmed === selectedReport.name) {
      setIsRenaming(false);
      setPendingReportName(selectedReport.name);
      return;
    }
    try {
      setRenameSaving(true);
      const response = await fetch(`/api/reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportName: trimmed,
          userName: selectedReport.userName,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'Failed to rename report');
      }
      setSelectedReport((prev) =>
        prev && prev.id === selectedReport.id
          ? { ...prev, name: trimmed }
          : prev
      );
      await loadReports();
      setIsRenaming(false);
    } catch (error) {
      console.error('Failed to rename report:', error);
      alert(
        error instanceof Error
          ? error.message
          : 'Failed to rename report. Please try again.'
      );
    } finally {
      setRenameSaving(false);
    }
  };

  const cancelRename = () => {
    if (!selectedReport) return;
    setIsRenaming(false);
    setPendingReportName(selectedReport.name);
    setRenameSaving(false);
  };

  if (selectedReport) {
    return (
      <main className='mx-auto max-w-7xl px-4 py-8'>
        <header className='mb-6'>
          <div className='flex items-center gap-4 mb-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setSelectedReport(null)}
            >
              <ArrowLeft className='mr-2 h-4 w-4' /> Back to Reports
            </Button>
          </div>
          <div className='flex  items-center gap-3'>
            {isRenaming ? (
              <form
                className='flex items-center gap-2'
                onSubmit={handleRenameSubmit}
              >
                <Input
                  autoFocus
                  value={pendingReportName}
                  onChange={(event) => setPendingReportName(event.target.value)}
                  className='w-96 text-black'
                />
                <Button
                  size='sm'
                  type='submit'
                  disabled={
                    renameSaving ||
                    !pendingReportName.trim() ||
                    pendingReportName.trim() === selectedReport.name
                  }
                >
                  {renameSaving && (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  )}
                  Save
                </Button>
                <Button
                  size='sm'
                  type='button'
                  variant='ghost'
                  onClick={cancelRename}
                  disabled={renameSaving}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <h1 className='text-2xl font-semibold tracking-tight'>
                  {selectedReport.name}
                </h1>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8'
                  aria-label='Rename report'
                  onClick={() => {
                    setPendingReportName(selectedReport.name);
                    setIsRenaming(true);
                  }}
                >
                  <Pencil className='h-4 w-4' />
                </Button>
              </>
            )}
          </div>
          <p className='text-sm text-muted-foreground'>
            Report opened in the Usage editor. Adjust values and save updates as
            needed.
          </p>
        </header>

        <UploadAnalyze
          key={selectedReport.id}
          initialPeriods={selectedReport.periods}
          initialReportName={selectedReport.name}
          initialUserName={selectedReport.userName}
          initialReportId={selectedReport.id}
        />
      </main>
    );
  }

  return (
    <main className='mx-auto max-w-7xl px-4 py-8'>
      <header className='mb-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              Saved Reports
            </h1>
            <p className='text-sm text-muted-foreground'>
              View and manage your previously saved reports
            </p>
          </div>
          <Link href='/'>
            <Button variant='outline'>
              <ArrowLeft className='mr-2 h-4 w-4' /> Back to Uploader
            </Button>
          </Link>
        </div>
      </header>

      {loading ? (
        <div className='flex items-center justify-center py-12'>
          <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
        </div>
      ) : Object.keys(reports).length === 0 ? (
        <Card>
          <CardContent className='py-12 text-center'>
            <FileText className='mx-auto h-12 w-12 text-muted-foreground mb-4' />
            <p className='text-muted-foreground'>No saved reports yet</p>
            <Link href='/'>
              <Button className='mt-4 bg-transparent' variant='outline'>
                Upload Reports
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className='space-y-6'>
          {Object.entries(reports).map(([userName, userReports]) => (
            <Card key={userName}>
              <CardHeader>
                <CardTitle>{userName}</CardTitle>
                <CardDescription>
                  {userReports.length} saved report(s)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className='space-y-2'>
                  {userReports.map((report) => (
                    <div
                      key={report.id}
                      className='flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors'
                    >
                      <div className='flex-1'>
                        <div className='flex items-center gap-2'>
                          <h3 className='font-medium'>{report.reportName}</h3>
                        </div>
                        <p className='text-sm text-muted-foreground'>
                          {new Intl.DateTimeFormat('en-UK', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(report.createdAt))}
                        </p>
                      </div>
                      <div className='flex gap-2'>
                        <Button size='sm' onClick={() => loadReport(report)}>
                          View
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          onClick={() =>
                            setDeleteConfirm({
                              id: report.id,
                              name: report.reportName,
                            })
                          }
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Separator className='my-6' />

      <footer className='text-xs text-muted-foreground'>
        Reports are stored in the project storage folder and grouped by user
        name.
      </footer>

      <AlertDialog
        open={deleteConfirm !== null}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && deleteReport(deleteConfirm.id)}
              className='bg-destructive text-white hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
