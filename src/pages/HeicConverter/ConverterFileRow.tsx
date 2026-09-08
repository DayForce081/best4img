import React from 'react';
import type { PageCopy } from '../../i18n';
import BaseFileRow from '../../components/ui/BaseFileRow';

export interface HeicEntry {
  id: string;
  file: File;
  name: string;
  originalSize: number;
  status: 'waiting' | 'converting' | 'completed' | 'error';
  errorMessage?: string;
  convertedBlob?: Blob;
  convertedUrl?: string;
  convertedSize?: number;
  width?: number;
  height?: number;
}



function truncateFilename(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return filename.length > 28 ? filename.slice(0, 28) + '...' : filename;
  }

  const name = filename.slice(0, lastDotIndex);
  const ext = filename.slice(lastDotIndex);

  if (name.length > 28) {
    return name.slice(0, 28) + '...' + ext;
  }
  return filename;
}

interface ConverterFileRowProps {
  entry: HeicEntry;
  onDownload: (entry: HeicEntry) => void;
  copy?: PageCopy['heicConverter'];
}

export default function ConverterFileRow({
  entry,
  onDownload,
  copy,
}: ConverterFileRowProps) {
  const isError = entry.status === 'error';
  const isCompleted = entry.status === 'completed';
  const isConverting = entry.status === 'converting';
  const isWaiting = entry.status === 'waiting';

  const rowBg = isError
    ? 'bg-red-50'
    : isCompleted
      ? 'bg-white hover:bg-slate-50'
      : isConverting
        ? 'bg-slate-50'
        : 'bg-white hover:bg-slate-50';

  return (
    <BaseFileRow
      isEasy={true}
      rowBgClass={rowBg}
      progressPercent={isConverting ? 100 : undefined} // We'll just show active background
      isError={isError}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p
            className={`min-w-0 text-sm font-medium text-slate-900 ${isError ? 'text-red-700' : ''}`}
            title={entry.name}
          >
            <span className="block truncate">{truncateFilename(entry.name)}</span>
          </p>
          <p className={`text-xs font-medium ${isError ? 'text-red-400' : 'text-slate-400'}`}>
            {isCompleted && entry.width && entry.height ? `${entry.width} × ${entry.height}` : isCompleted ? 'JPG' : 'HEIC'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:justify-end">
        {isConverting && (
          <span className="w-[112px] text-left text-sm font-bold text-indigo-600 animate-pulse">
            {copy?.statuses.converting ?? 'Converting...'}
          </span>
        )}
        {isWaiting && (
          <span className="w-[112px] text-left text-sm font-medium text-slate-400">
            {copy?.statuses.waiting ?? 'Waiting...'}
          </span>
        )}
        {isCompleted && (
          <button
            onClick={() => onDownload(entry)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[5px] text-sm font-semibold uppercase text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-800"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>{copy?.actions.download ?? 'Download'}</span>
          </button>
        )}
        {(isConverting || isWaiting) && (
          <div className="inline-flex items-center gap-2 px-2 py-1 text-sm font-semibold uppercase text-slate-300">
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>{copy?.actions.download ?? 'Download'}</span>
          </div>
        )}
        {isError && (
          <div
            className="inline-flex max-w-[240px] items-center gap-2 px-2 py-1 text-sm font-medium text-red-400"
            title={entry.errorMessage || copy?.statuses.error || 'Error'}
          >
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span className="truncate whitespace-nowrap">
              {entry.errorMessage || copy?.statuses.error || 'Error'}
            </span>
          </div>
        )}
      </div>
    </BaseFileRow>
  );
}
