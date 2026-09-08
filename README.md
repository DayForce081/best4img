# BEST4IMG Image Compressor

BEST4IMG is a purely client-side image compression app built with React, TypeScript, Vite, WebAssembly, and Web Workers. It keeps images on-device, compresses JPG/PNG/WebP/AVIF in the browser, and moves decoding plus pixel extraction off the main thread to avoid UI jank on larger files.

## Highlights

- 100% client-side processing: no uploads, no server-side image pipeline.
- Worker-first architecture: `createImageBitmap` and `OffscreenCanvas` run inside the worker, not on the main thread.
- Format-aware compression:
  - JPEG uses `mozjpeg` with an SSIM-guided binary search for photo content.
  - PNG uses quantization plus `oxipng` for stronger size reduction.
  - WebP and AVIF stay in-format and preserve the current compression strategy.
- Size guardrail: if recompression would make the file larger, BEST4IMG returns the original file.
- Batch workflow: queue up to 20 files and download the finished output as a `.zip`.
- Low-overhead default UI: the current interface is the simplified performance-focused frontend.

## What Changed Recently

- Image decoding and `ImageData` extraction were moved fully into [`src/workers/compressor.worker.ts`](/Users/dayang/Desktop/tinyflow/src/workers/compressor.worker.ts).
- The main thread now only reads the source `ArrayBuffer`, updates UI state, and receives worker messages.
- The default UI was replaced with the simplified low-overhead frontend.
- Progress indication was smoothed on the UI side using file-size-aware pseudo progress, without changing the compression algorithm itself.

## Stack

- React 19
- TypeScript
- Vite 6
- Tailwind CSS 4
- `@jsquash/jpeg`
- `@jsquash/png`
- `@jsquash/oxipng`
- `@jsquash/webp`
- `@jsquash/avif`
- `imagequant`
- `jszip`

## Project Structure

```txt
tinyflow/
├── public/
│   └── wasm/                     # Statically served Wasm binaries
├── src/
│   ├── components/
│   │   ├── EasyPage.tsx          # Current default page
│   │   ├── FileRow.tsx           # Result item UI
│   │   ├── ImageCompressor.tsx   # Drop zone, queue, progress, downloads
│   ├── workers/
│   │   └── compressor.worker.ts  # Decode, profile, compress, and post results
│   ├── App.tsx
│   ├── index.css
│   └── types.ts
├── vite.config.ts
└── package.json
```

## Development

### Prerequisites

- Node.js 18+

### Install

```bash
npm install
```

### Run Locally

Vite is configured to run strictly on port `3001`.

```bash
npm run dev
```

Open:

- [http://localhost:3001](http://localhost:3001)

### Build

```bash
npm run build
```

## Notes

- Maximum file size is currently `10MB` per file.
- Maximum batch size is `20` files.
- Older browsers that do not support `createImageBitmap` and `OffscreenCanvas` in workers are not a target for the worker-only decoding path.

## Deployment

This is a static frontend app. Deploy the `dist/` output to any static hosting provider.
