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
        <div className='relative flex items-center justify-center px-12'>
          <Image
            src='/UNDP_logo.svg-1.png'
            alt='UNDP logo'
            width={32}
            height={32}
            className='absolute left-0 top-1/2 -translate-y-1/2 object-contain'
          />
          <h1 className='text-center text-2xl font-semibold tracking-tight'>
            IRH Paper Consumption Dashboard
          </h1>
          <Link
            href='/saved-reports'
            className='absolute right-0 top-1/2 -translate-y-1/2'
          >
            <Button variant='outline'>
              <FileText className='mr-2 h-4 w-4' /> Saved Reports
            </Button>
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Upload report</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadAnalyze />
        </CardContent>
      </Card>
    </main>
  );
}
