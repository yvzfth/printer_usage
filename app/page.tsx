import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import Image from 'next/image';

import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import UploadAnalyze from '@/components/upload-analyze';
import Link from 'next/link';
import { FileText } from 'lucide-react';

export default function Page() {
  return (
    <main className='mx-auto max-w-7xl px-4 py-8'>
      <header className='mb-6'>
        <div className='flex items-center justify-between'>
          <Image
            src='/UNDP_logo.svg-1.png'
            alt='UNDP logo'
            width={32}
            height={32}
            className='object-contain'
          />
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              IRH Paper Consumption Dashboard
            </h1>
          </div>
          <Link href='/saved-reports'>
            <Button variant='outline'>
              <FileText className='mr-2 h-4 w-4' /> Saved Reports
            </Button>
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Upload report</CardTitle>
          <CardDescription>
            Upload exported HTML report to see the per-user print statistics.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadAnalyze />
        </CardContent>
      </Card>
    </main>
  );
}
