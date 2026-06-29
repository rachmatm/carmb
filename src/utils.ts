// Format bytes to human readable
export function formatBytes(bytes: number): string {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Extract the largest detected license plate bounding box
export function findPlateBox(detections: any[]): { x: number, y: number, w: number, h: number } | null {
    if (!Array.isArray(detections) || detections.length === 0) return null;

    const plates = detections.filter((d: any) =>
        d.label === 'license-plates' || d.label === 'license_plate'
    );

    const list = plates.length > 0 ? plates : detections;
    const best = list.reduce((a: any, b: any) => {
        const areaA = (a.box.xmax - a.box.xmin) * (a.box.ymax - a.box.ymin);
        const areaB = (b.box.xmax - b.box.xmin) * (b.box.ymax - b.box.ymin);
        return areaA > areaB ? a : b;
    });

    return {
        x: best.box.xmin,
        y: best.box.ymin,
        w: best.box.xmax - best.box.xmin,
        h: best.box.ymax - best.box.ymin,
    };
}
