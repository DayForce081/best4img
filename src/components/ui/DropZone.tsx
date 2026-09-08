import React, { useCallback, useRef, useState } from 'react';

interface DropZoneProps {
  onFilesSelect: (files: File[]) => void;
  accept: string;
  maxFiles?: number;
  maxFileSize?: number;
  isEasy?: boolean;
  copy?: {
    dropTitle?: string;
    dropHint?: string;
  };
}

export default function DropZone({
  onFilesSelect,
  accept,
  maxFiles = 50,
  maxFileSize = 10 * 1024 * 1024,
  isEasy = true,
  copy
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      onFilesSelect(droppedFiles);
    },
    [onFilesSelect]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files ? Array.from(e.target.files) : [];
      onFilesSelect(selected);
      if (inputRef.current) inputRef.current.value = '';
    },
    [onFilesSelect]
  );

  return (
    <div className={isEasy ? 'rounded-xl border border-slate-200/70 bg-white/72 p-10 shadow-sm backdrop-blur-[2px]' : 'bg-white/40 backdrop-blur-sm rounded-xl p-10 shadow-sm'}>
      <div
        className={`border-2 border-dashed rounded-lg p-2 text-center transition-all duration-300 group relative overflow-hidden cursor-pointer ${
          isEasy ? 'hover:bg-slate-50' : 'hover:bg-white'
        } ${isDragOver ? 'drop-zone-active border-indigo-300' : isEasy ? 'border-slate-300' : 'border-blue-200/50'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles > 1}
          accept={accept}
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex flex-col items-center gap-2 py-4">
          <div className={`mb-1 flex items-center justify-center transition-colors duration-300 w-20 h-20 ${isEasy ? 'text-slate-300 group-hover:text-slate-500' : 'text-primary/20 group-hover:text-primary'}`}>
            <span className="material-symbols-outlined !text-6xl">
              upload_file
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">
            {copy?.dropTitle ?? 'Drop or Select your files here'}
          </h1>
          <p className="font-medium text-sm text-slate-500">
            {copy?.dropHint ?? `up to ${maxFiles} files, max ${maxFileSize / (1024 * 1024)}MB each`}
          </p>
        </div>
      </div>
    </div>
  );
}
