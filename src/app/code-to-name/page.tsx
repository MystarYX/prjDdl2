'use client';

import CodeToNameConfig from '@/components/CodeToNameConfig';

export default function CodeToNamePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <CodeToNameConfig />
      </div>
    </div>
  );
}

