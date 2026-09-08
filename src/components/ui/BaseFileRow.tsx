import React from 'react';

interface BaseFileRowProps {
  isEasy?: boolean;
  rowBgClass?: string;
  index?: number;
  progressPercent?: number; // 0-100 to show background green progress
  isError?: boolean;
  children: React.ReactNode;
}

export default function BaseFileRow({
  isEasy = true,
  rowBgClass = 'bg-white hover:bg-slate-50',
  index = 0,
  progressPercent,
  isError = false,
  children,
}: BaseFileRowProps) {
  if (isEasy) {
    return (
      <article className={`${rowBgClass} relative overflow-hidden rounded-xl px-4 py-3 shadow-sm ring-1 ring-slate-200 transition-colors`}>
        {progressPercent !== undefined && progressPercent >= 0 && (
          <div
            className="absolute inset-y-0 left-0 transition-all duration-300"
            style={{ width: `${Math.max(progressPercent, 10)}%`, backgroundColor: '#76bf77' }}
          />
        )}
        {isError && (
          <div className="absolute inset-y-0 left-0 w-full bg-red-50/60" />
        )}

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {children}
        </div>
      </article>
    );
  }

  // Not easy / table mode fallback wrapping
  return (
    <>
      {index > 0 && <tr className="h-2" />}
      <tr
        className={`${rowBgClass} transition-colors group file-row-enter`}
        style={{ animationDelay: `${index * 60}ms` }}
      >
        {children}
      </tr>
    </>
  );
}
