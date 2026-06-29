import { env, pipeline, RawImage } from '@huggingface/transformers';
import { findPlateBox } from './utils';

let segmenter: any = null;
let plateDetector: any = null;
let device: 'webgpu' | 'wasm' = 'wasm';

// Max dimension for inference — downscale large images before model input,
// then upscale the mask back. Cuts inference time dramatically for 4K+ photos.
const MAX_INFER_DIM = 1024;

// Local model base URL (served from public/models/rmbg/)
const LOCAL_MODEL_BASE = new URL('/models/rmbg', self.location.origin).href;

// Intercept transformers.js fetches for RMBG-1.4 and redirect to local quantized model (44 MB).
const _originalFetch = env.fetch;
env.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('briaai/RMBG-1.4')) {
        if (url.includes('config.json') && !url.includes('preprocessor')) {
            return _originalFetch(`${LOCAL_MODEL_BASE}/config.json`, init);
        }
        if (url.includes('.onnx')) {
            // Always serve the quantized model regardless of what filename transformers.js requests
            return _originalFetch(`${LOCAL_MODEL_BASE}/onnx/model_quantized.onnx`, init);
        }
        if (url.includes('preprocessor_config.json')) {
            return _originalFetch(`${LOCAL_MODEL_BASE}/preprocessor_config.json`, init);
        }
    }
    return _originalFetch(input as any, init);
};

// Detect best available device (WebGPU if available, else WASM)
async function detectDevice(): Promise<'webgpu' | 'wasm'> {
    // @ts-ignore — navigator.gpu may not exist in types
    if (typeof navigator !== 'undefined' && navigator.gpu) {
        try {
            const adapter = await (navigator as any).gpu.requestAdapter();
            if (adapter) return 'webgpu';
        } catch {}
    }
    return 'wasm';
}

// Load plate detector on demand (deferred so BG removal starts sooner)
async function loadPlateDetector() {
    if (plateDetector) return;

    self.postMessage({ type: 'status', status: 'loading', message: 'Loading plate detection model...' });
    plateDetector = await pipeline('object-detection', 'onnx-community/yolos-small-finetuned-license-plate-detection-ONNX', {
        device,
        dtype: device === 'webgpu' ? 'fp16' : 'q4f16',
        session_options: {
            graphOptimizationLevel: 'disabled',
        },
    });
}

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        try {
            // 1. Detect best device
            device = await detectDevice();
            self.postMessage({ type: 'status', status: 'loading', message: `Using ${device.toUpperCase()} — Loading background model...` });

            // 2. Load RMBG-1.4 quantized (44 MB) — local files via fetch interception
            segmenter = await pipeline('background-removal', 'briaai/RMBG-1.4', {
                device,
                dtype: 'int8',
                session_options: {
                    graphOptimizationLevel: 'disabled',
                },
            });

            // 3. Warm up with a real (tiny) inference to JIT-compile execution providers
            self.postMessage({ type: 'status', status: 'loading', message: 'Warming up model...' });
            try {
                const warmup = new RawImage(new Uint8ClampedArray(64 * 64 * 4), 64, 64, 4);
                await segmenter(warmup, { threshold: 0.5 });
            } catch { /* warmup may partially fail — that's fine, providers are compiled */ }

            self.postMessage({ type: 'status', status: 'ready' });
        } catch (error: any) {
            self.postMessage({ type: 'status', status: 'error', message: error.message });
        }
    }

    if (type === 'process') {
        try {
            const { imageData, width, height, origWidth, origHeight } = payload;

            // Lazy-load plate detector on first use (saves ~seconds on init)
            await loadPlateDetector();

            // --- Background removal ---
            self.postMessage({ type: 'status', status: 'processing', message: 'Removing background...' });

            const rawImage = new RawImage(new Uint8ClampedArray(imageData), width, height, 4);

            // Downscale for inference, run model, upscale result to original image size
            const inferImage = resizeRawImage(rawImage, MAX_INFER_DIM);
            const output = await segmenter(inferImage, { threshold: 0.5 });
            const resultW = origWidth || width;
            const resultH = origHeight || height;
            const resultImage = await output.resize(resultW, resultH);

            // --- License plate detection ---
            self.postMessage({ type: 'status', status: 'processing', message: 'Detecting license plates...' });
            const detections = await plateDetector(rawImage, { threshold: 0.5 });

            // Scale plate box from transfer dimensions to original image dimensions
            let plateBox = findPlateBox(detections);
            if (plateBox && (resultW !== width || resultH !== height)) {
                const sx = resultW / width;
                const sy = resultH / height;
                plateBox = {
                    x: Math.round(plateBox.x * sx),
                    y: Math.round(plateBox.y * sy),
                    w: Math.round(plateBox.w * sx),
                    h: Math.round(plateBox.h * sy),
                };
            }

            // Transfer result buffer back (zero-copy)
            const resultBuffer = resultImage.data.buffer;
            self.postMessage({
                type: 'result',
                resultImageData: resultBuffer,
                resultWidth: resultImage.width,
                resultHeight: resultImage.height,
                plateBox,
            }, { transfer: [resultBuffer] });
        } catch (error: any) {
            self.postMessage({ type: 'error', message: error.message });
        }
    }
};

// Scale image down so the longest side == maxDim (preserves aspect ratio).
// Short-circuits if already within bounds.
function resizeRawImage(img: RawImage, maxDim: number): RawImage {
    const { width, height } = img;
    if (width <= maxDim && height <= maxDim) return img;

    const scale = maxDim / Math.max(width, height);
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);

    // Off-screen canvas resize
    const src = new OffscreenCanvas(width, height);
    const srcCtx = src.getContext('2d')!;
    srcCtx.putImageData(new ImageData(new Uint8ClampedArray(img.data), width, height), 0, 0);

    const dst = new OffscreenCanvas(newW, newH);
    const dstCtx = dst.getContext('2d')!;
    dstCtx.drawImage(src, 0, 0, newW, newH);

    const resized = dstCtx.getImageData(0, 0, newW, newH);
    return new RawImage(resized.data, newW, newH, 4);
}
