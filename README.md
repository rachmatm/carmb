# Car Background Replacer

A fully client-side web app that removes car backgrounds and replaces license plates using AI. All processing runs in the browser - no server, no uploads.

## Project Background

This demo showcases browser-based AI inference for automotive image processing. The goal is to take a car photo, remove its background, composite it onto a new scene, and overlay a replacement license plate - all without sending images to a server.

The demo is intended as a proof-of-concept. Production will use a dedicated server for faster and more reliable inference. Browser-based AI is limited by device hardware, browser resource caps (e.g. throttling on low battery), and model size constraints.

## Technical Stack & Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite + TypeScript |
| AI Runtime | Transformers.js (`@huggingface/transformers` v4.2.0) |
| ONNX Backend | onnxruntime-web v1.24.3 (overridden from dev build) |
| BG Removal | RMBG-1.4 (BriaAI) - INT8 quantized, 44 MB |
| Plate Detection | YOLOS (ONNX Community) - q4f16 quantized |
| Rendering | HTML5 Canvas API |
| Threading | Web Workers |

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Main Thread (main.ts)                              │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ File    │-> │ Pre-     │-> │ Canvas          │   │
│  │ Input   │  │ resize   │  │ Compositing       │   │
│  └─────────┘  │ (1500px) │  │ (bg + car + plate)│   │
│               └──────────┘  └───────────────────┘   │
│                     v postMessage (zero-copy)       │
├─────────────────────────────────────────────────────┤
│  Web Worker (worker.ts)                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Fetch    │-> │ RMBG-1.4 │-> │ YOLOS Plate    │   │
│  │ Inter-   │  │ (44 MB)  │  │ Detector         │   │
│  │ ception  │  │ infer @  │  │ (lazy-loaded)    │   │
│  │          │  │ 1024px   │  │                  │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Data flow:**
1. User uploads image -> main thread pre-resizes to 1500px max -> transfers buffer to worker (zero-copy)
2. Worker downscales to 1024px for inference -> runs RMBG-1.4 -> upscales mask to original dimensions
3. Worker runs YOLOS plate detection (first image only) -> returns result + plate bounding box
4. Main thread composites: background image -> car (bg removed) -> plate overlay
5. User downloads the final image

## Key Decisions & Rationale

### Web Worker for AI
Model loading and inference run off the main thread. Without this, the page freezes during the ~44 MB model download and heavy ONNX computation. The worker communicates via `postMessage` with zero-copy buffer transfers.

### Quantized RMBG-1.4 (44 MB)
The repo offers three ONNX variants: `model.onnx` (176 MB), `model_fp16.onnx` (88 MB), `model_quantized.onnx` (44 MB). The INT8 quantized version is 4x smaller than the original with acceptable quality loss for this demo.

### Local model serving via fetch interception
Transformers.js only accepts `org/model` format IDs (e.g. `briaai/RMBG-1.4`) - not URLs or local paths. To serve the quantized model locally, we override `env.fetch` to intercept requests for `briaai/RMBG-1.4` and redirect them to `public/models/rmbg/`. This avoids downloading from Hugging Face on every visit.

### `graphOptimizationLevel: 'disabled'`
ONNX Runtime Web's `SimplifiedLayerNormFusion` optimization pass crashes on RMBG-1.4's ViT architecture. Disabling graph optimizations via `session_options` is the only workaround. See [FIXES.md](FIXES.md) for details.

### Two-stage image resizing
Large images are pre-resized on the main thread (1500px max) before transfer, then further downscaled in the worker (1024px max) for inference. The segmentation mask is upscaled back to original dimensions in a single step. This avoids transferring and processing multi-megapixel images at full resolution.

### Lazy plate detector
The YOLOS plate detection model loads on first image upload, not during init. This means background removal is ready as soon as RMBG finishes loading - users can start working while the plate detector downloads in the background.

### onnxruntime-web version override
Transformers.js v4.2.0 ships with `onnxruntime-web@1.26.0-dev` which has the `SimplifiedLayerNormFusion` crash. We override it to `1.24.3` (stable) via npm `overrides` in `package.json`.

## Execution Steps

### 1. Project setup
```bash
npm install          # Install dependencies + apply onnxruntime-web override
npm run dev          # Start Vite dev server
```

### 2. Model preparation (already done)
The quantized model and config files are in `public/models/rmbg/`:
- `config.json` - model config with `model_type: 'segformer'` fix
- `preprocessor_config.json` - image preprocessing config
- `onnx/model_quantized.onnx` - INT8 quantized ONNX model (44 MB)

### 3. Build for production
```bash
npm run build        # TypeScript check + Vite production build
npm run preview      # Preview production build locally
```

### 4. Deploy
Deploy the `dist/` output to Vercel (stateless static site).

## Testing & Deployment

### Testing Plan (pending)

**Functional tests:**
- [ ] Upload a car photo -> background removed correctly
- [ ] License plate detected and bounding box is accurate
- [ ] Plate replacement image overlays at correct position
- [ ] Download button produces a valid PNG with all compositing layers
- [ ] Fallback plate position works when no plate is detected

**Performance tests:**
- [ ] Model loads within acceptable time on 4G connection
- [ ] Inference completes within 5s for a 1920x1080 image
- [ ] Progress bar accurately reflects download progress across all files
- [ ] No memory leaks after processing multiple images

**Browser compatibility:**
- [ ] Chrome/Edge (WASM)
- [ ] Firefox (WASM)
- [ ] Safari (WASM)
- [ ] Mobile Chrome (Android)
- [ ] Mobile Safari (iOS)

**Edge cases:**
- [ ] Very large images (4000px+)
- [ ] Very small images (<500px)
- [ ] Images with no car
- [ ] Images with multiple cars
- [ ] WebGPU-capable devices (should auto-detect and use WebGPU)

### Deployment (Vercel)

This is a static site - deploy the `dist/` directory to Vercel:

1. Connect the repo to Vercel
2. Build command: `npm run build`
3. Output directory: `dist`
4. No environment variables needed (stateless)
5. No server-side functions needed

The ~44 MB model file is served as a static asset from `public/models/rmbg/`. Vercel's CDN will cache it at the edge after the first request.

## Run Locally

### Prerequisites

Install Node.js (LTS) from [nodejs.org](https://nodejs.org/).

```bash
node --version
npm --version
```

### Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.
