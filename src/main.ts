import { formatBytes } from './utils';

// UI Query Selectors
const fileInput = document.getElementById('upload') as HTMLInputElement;
const originalCanvas = document.getElementById('original') as HTMLCanvasElement;
const processedCanvas = document.getElementById('processed') as HTMLCanvasElement;
const ctxOrig = originalCanvas.getContext('2d')!;
const ctxProc = processedCanvas.getContext('2d')!;
const loadingEl = document.getElementById('loading')!;
const loadingStatus = document.getElementById('loading-status') as HTMLDivElement;
const loadingBar = document.getElementById('loading-bar') as HTMLDivElement;
const processingEl = document.getElementById('processing') as HTMLDivElement;
const processingStatus = document.getElementById('processing-status') as HTMLDivElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;

let bgImage: HTMLImageElement | null = null;
let plateImage: HTMLImageElement | null = null;
let worker: Worker | null = null;

// Track download progress across files
const fileProgress = new Map<string, { loaded: number; total: number }>();

// Max dimension for data sent to the worker (reduces transfer + memory)
const MAX_TRANSFER_DIM = 1500;

// Helper to load an image as a promise
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Initialize: load bg image and start worker
async function init() {
    try {
        // Load background replacement image
        loadingStatus.textContent = 'Loading background image...';
        bgImage = await loadImage('/bg.png');

        // Load license plate replacement image
        loadingStatus.textContent = 'Loading plate image...';
        plateImage = await loadImage('/plat.png');

        // Start the AI worker
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

        worker.onmessage = (e: MessageEvent) => {
            const { type, status, message, resultImageData, resultWidth, resultHeight, plateBox } = e.data;

            if (type === 'status') {
                if (status === 'loading') {
                    loadingStatus.textContent = message;
                    fileProgress.clear();
                } else if (status === 'ready') {
                    loadingEl.style.display = 'none';
                    fileInput.disabled = false;
                } else if (status === 'error') {
                    loadingStatus.textContent = `Error: ${message}`;
                    loadingBar.style.width = '0%';
                } else if (status === 'processing') {
                    processingStatus.textContent = message;
                }
            }

            if (type === 'progress') {
                const { model, file, loaded, total, status: progressStatus } = e.data;
                const loadedBytes = Number(loaded) || 0;
                const totalBytes = Number(total) || 0;

                // Track per-file progress
                if (progressStatus === 'done') {
                    const entry = fileProgress.get(file);
                    if (entry) entry.loaded = entry.total;
                } else {
                    fileProgress.set(file, { loaded: loadedBytes, total: totalBytes || fileProgress.get(file)?.total || 0 });
                }

                // Calculate overall progress across all files
                let totalLoaded = 0;
                let totalSize = 0;
                for (const [, fp] of fileProgress) {
                    totalLoaded += fp.loaded;
                    totalSize += fp.total;
                }

                const pct = totalSize > 0 ? Math.min(100, Math.round((totalLoaded / totalSize) * 100)) : 0;
                const sizeText = totalSize > 0
                    ? `${formatBytes(totalLoaded)} / ${formatBytes(totalSize)}`
                    : totalLoaded > 0 ? formatBytes(totalLoaded) : 'downloading...';
                loadingStatus.textContent = `${model}: ${file.split('/').pop()} (${sizeText}) — ${pct}%`;
                loadingBar.style.width = `${pct}%`;
            }

            if (type === 'result') {
                // resultImageData is a transferred ArrayBuffer
                applyResult(new Uint8ClampedArray(resultImageData), resultWidth, resultHeight, plateBox);
                processingEl.style.display = 'none';
                downloadBtn.style.display = 'block';
            }

            if (type === 'error') {
                processingStatus.textContent = `Error: ${message}`;
            }
        };

        worker.postMessage({ type: 'init' });
    } catch (error) {
        console.error('Failed to initialize:', error);
        loadingStatus.textContent = 'Failed to initialize. Check console.';
    }
}

init();

// Process image file on upload
fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !worker) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        const img = new Image();
        img.onload = async () => {
            // Show processing indicator, hide download button
            processingEl.style.display = 'flex';
            downloadBtn.style.display = 'none';
            processingStatus.textContent = 'Preparing image...';

            // Show original at full resolution
            originalCanvas.width = img.width;
            originalCanvas.height = img.height;
            ctxOrig.drawImage(img, 0, 0);

            // Pre-resize for worker transfer (reduces buffer size + worker memory)
            const { canvas: sendCanvas, width: sendW, height: sendH } = fitToMax(img, MAX_TRANSFER_DIM);
            const sendCtx = sendCanvas.getContext('2d')!;
            const imgData = sendCtx.getImageData(0, 0, sendW, sendH);

            // Prepare processed canvas at original dimensions
            processedCanvas.width = img.width;
            processedCanvas.height = img.height;

            // Transfer buffer to worker (zero-copy)
            worker!.postMessage({
                type: 'process',
                payload: {
                    imageData: imgData.data.buffer,
                    width: sendW,
                    height: sendH,
                    // Pass original dimensions so the worker can upscale the result
                    origWidth: img.width,
                    origHeight: img.height,
                },
            }, { transfer: [imgData.data.buffer] });
        };
        img.src = event.target!.result as string;
    };
    reader.readAsDataURL(file);
});

// Resize an image element so the longest side == maxDim (preserves aspect ratio).
// Returns a canvas + the new dimensions. Short-circuits if already within bounds.
function fitToMax(img: HTMLImageElement, maxDim: number): { canvas: HTMLCanvasElement; width: number; height: number } {
    if (img.width <= maxDim && img.height <= maxDim) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return { canvas: c, width: img.width, height: img.height };
    }
    const scale = maxDim / Math.max(img.width, img.height);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return { canvas: c, width: w, height: h };
}

// Apply results from worker onto the processed canvas
function applyResult(resultImageData: Uint8ClampedArray, resultWidth: number, resultHeight: number, plateBox: { x: number, y: number, w: number, h: number } | null) {
    // 1. Draw background-removed image onto temp canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = resultWidth;
    tempCanvas.height = resultHeight;
    const tempCtx = tempCanvas.getContext('2d')!;
    const imgData = tempCtx.createImageData(resultWidth, resultHeight);
    imgData.data.set(resultImageData);
    tempCtx.putImageData(imgData, 0, 0);

    // 2. Clear processed canvas and draw bg.png as background
    ctxProc.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
    if (bgImage) {
        ctxProc.drawImage(bgImage, 0, 0, processedCanvas.width, processedCanvas.height);
    }

    // 3. Draw the car (with bg removed) on top — result is already at original dimensions
    ctxProc.drawImage(tempCanvas, 0, 0);

    // 4. If plate detected, replace it with plat.png (plate box is in original dimensions)
    if (plateBox && plateImage) {
        ctxProc.drawImage(plateImage, plateBox.x, plateBox.y, plateBox.w, plateBox.h);
    } else if (plateImage) {
        // Fallback: draw plate in lower-center area
        const fallbackW = Math.floor(processedCanvas.width * 0.35);
        const fallbackH = Math.floor(fallbackW * 0.22);
        const fallbackX = (processedCanvas.width - fallbackW) / 2;
        const fallbackY = processedCanvas.height - (processedCanvas.height * 0.2);
        ctxProc.drawImage(plateImage, fallbackX, fallbackY, fallbackW, fallbackH);
    }
}

// Download button handler
downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'processed-car.png';
    link.href = processedCanvas.toDataURL('image/png');
    link.click();
});
