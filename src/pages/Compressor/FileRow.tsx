import React from 'react';
import type { FileEntry } from '../../types';
import type { PageCopy } from '../../i18n';
import BaseFileRow from '../../components/ui/BaseFileRow';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatOriginalMeta(entry: FileEntry): string {
  if (entry.width && entry.height) {
    return `${entry.width}×${entry.height} ${formatSize(entry.originalSize)}`;
  }
  return formatSize(entry.originalSize);
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

interface FileRowProps {
  entry: FileEntry;
  index: number;
  onDownload: (entry: FileEntry) => void;
  variant?: 'default' | 'easy';
  copy?: PageCopy['compressor'];
}

export default function FileRow({
  entry,
  index,
  onDownload,
  variant = 'default',
  copy,
}: FileRowProps) {
  const isError = entry.status === 'error';
  const isCompleted = entry.status === 'completed';
  const isCompressing = entry.status === 'compressing';
  const isWaiting = entry.status === 'waiting';
  const isEasy = variant === 'easy';

  const compressionPercent =
    isCompleted && entry.compressedSize != null
      ? Math.round((1 - entry.compressedSize / entry.originalSize) * 100)
      : null;

  // Row background per state
  const rowBg = isError
    ? isEasy ? 'bg-red-50' : 'bg-red-50/50'
    : isCompleted
      ? isEasy ? 'bg-white hover:bg-slate-50' : 'bg-white/60 hover:bg-white'
      : isCompressing
        ? isEasy ? 'bg-slate-50' : 'bg-white/40'
        : isEasy ? 'bg-white hover:bg-slate-50' : 'bg-white/60 hover:bg-white';

  if (isEasy) {
    return (
      <BaseFileRow
        isEasy={true}
        rowBgClass={rowBg}
        progressPercent={isCompressing ? entry.progress : undefined}
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
              {formatOriginalMeta(entry)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:justify-end">
          {isCompleted && entry.compressedSize != null && (
            <span className="w-[112px] text-left text-sm font-medium text-slate-600">
              {formatSize(entry.compressedSize)} /{' '}
              <span className="font-bold text-emerald-700">-{compressionPercent}%</span>
            </span>
          )}
          {isCompressing && (
            <span className="w-[112px] text-left text-sm font-medium text-blue-700">
              {copy?.statuses.compressing ?? 'Compressing...'}
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
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[5px] text-sm font-semibold uppercase text-[#3525cd] transition-colors hover:bg-primary-fixed hover:text-[#24189d]"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>{copy?.actions.download ?? 'Download'}</span>
            </button>
          )}
          {(isCompressing || isWaiting) && (
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

  return (
    <BaseFileRow isEasy={false} rowBgClass={rowBg} index={index}>
      {/* File Name */}
      <td className="py-[1.1rem] rounded-tl-xl rounded-bl-xl px-4 pl-8 w-[20.625rem] min-w-[20.625rem] max-w-[20.625rem]">
        <div className="flex items-center gap-3">
          <span className={`text-[13px] break-all line-clamp-1 ${isError ? 'text-red-700' : ''}`} title={entry.name}>
            {entry.name}
          </span>
        </div>
      </td>

      {/* Original Size */}
      <td
        className={`py-[1.1rem] whitespace-nowrap px-4 ${isError ? 'text-red-400 font-bold' : 'text-slate-400'
          }`}
      >
        {formatOriginalMeta(entry)}
      </td>

      {/* Status / Progress Bar */}
      <td className="py-[1.1rem] px-4">
        {isCompleted && (
          <div className="relative w-[12rem] h-6 bg-emerald-100 rounded-full overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 transition-all duration-500" style={{ backgroundColor: '#76bf77' }} />
            <span className="relative text-xs font-semibold text-white">
              {copy?.statuses.completed ?? 'Completed'}
            </span>
          </div>
        )}
        {isCompressing && (
          <div className="relative w-[12rem] h-6 bg-emerald-100 rounded-full overflow-hidden flex items-center justify-center progress-pulse">
            <div
              className="absolute top-0 left-0 bottom-0 transition-all duration-300 progress-shimmer"
              style={{ width: `${Math.max(entry.progress, 10)}%`, backgroundColor: '#76bf77' }}
            />
            <span className="relative text-xs font-semibold text-emerald-900">
              {copy?.statuses.compressing ?? 'Compressing...'}
            </span>
          </div>
        )}
        {isWaiting && (
          <div className="relative w-[12rem] h-6 bg-slate-100 rounded-full overflow-hidden flex items-center justify-center">
            <span className="relative text-xs font-medium text-slate-400">
              {copy?.statuses.waiting ?? 'Waiting...'}
            </span>
          </div>
        )}
        {isError && (
          <div className="relative w-[12rem] h-6 bg-red-100 rounded-full overflow-hidden flex items-center justify-center">
            <span className="relative text-xs font-semibold text-red-700">
              {entry.errorMessage || copy?.statuses.error || 'Error'}
            </span>
          </div>
        )}
      </td>

      {/* Result (compressed size / percentage) */}
      <td className="py-[1.1rem] whitespace-nowrap px-4">
        {isCompleted && entry.compressedSize != null && (
          <>
            {formatSize(entry.compressedSize)} /{' '}
            <span className="text-emerald-700">-{compressionPercent}%</span>
          </>
        )}
        {isCompressing && (
          <span className="italic text-outline">{copy?.statuses.waiting ?? 'Waiting...'}</span>
        )}
        {isWaiting && (
          <span className="italic text-slate-300">—</span>
        )}
        {isError && (
          <span className="text-red-200">-</span>
        )}
      </td>

      {/* Action Button */}
      <td className="py-[1.1rem] text-right rounded-tr-xl rounded-br-xl px-4 pr-8">
        {isCompleted && (
          <button
            onClick={() => onDownload(entry)}
            className="text-primary hover:bg-primary/10 px-3 py-1.5 rounded-lg transition-all flex items-center gap-2 ml-auto whitespace-nowrap cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">download</span>
            <span className="text-xs font-bold uppercase tracking-wider">
              {copy?.actions.download ?? 'Download'}
            </span>
          </button>
        )}
        {(isCompressing || isWaiting) && (
          <button
            disabled
            className="text-outline cursor-not-allowed px-3 py-1.5 rounded-lg flex items-center gap-2 ml-auto opacity-50 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-lg">
              hourglass_empty
            </span>
            <span className="text-xs font-bold uppercase tracking-wider">
              {copy?.actions.download ?? 'Download'}
            </span>
          </button>
        )}
        {isError && (
          <div className="text-red-300 pr-4">
            <span className="material-symbols-outlined">error</span>
          </div>
        )}
      </td>
    </BaseFileRow>
  );
}
