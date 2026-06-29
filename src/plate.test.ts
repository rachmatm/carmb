import { describe, it, expect } from 'vitest';
import { findPlateBox } from './utils';

describe('findPlateBox', () => {
    it('returns null for empty array', () => {
        expect(findPlateBox([])).toBeNull();
    });

    it('returns null for non-array', () => {
        expect(findPlateBox(null as any)).toBeNull();
        expect(findPlateBox(undefined as any)).toBeNull();
    });

    it('returns box from single detection', () => {
        const detections = [{
            label: 'license-plates',
            box: { xmin: 10, ymin: 20, xmax: 110, ymax: 70 }
        }];
        expect(findPlateBox(detections)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    });

    it('returns largest plate when multiple plates exist', () => {
        const detections = [
            { label: 'license-plates', box: { xmin: 0, ymin: 0, xmax: 50, ymax: 20 } },
            { label: 'license-plates', box: { xmin: 100, ymin: 100, xmax: 300, ymax: 200 } },
        ];
        expect(findPlateBox(detections)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
    });

    it('filters by license_plate label', () => {
        const detections = [
            { label: 'car', box: { xmin: 0, ymin: 0, xmax: 500, ymax: 500 } },
            { label: 'license_plate', box: { xmin: 10, ymin: 20, xmax: 60, ymax: 40 } },
        ];
        expect(findPlateBox(detections)).toEqual({ x: 10, y: 20, w: 50, h: 20 });
    });

    it('falls back to largest detection if no plate label', () => {
        const detections = [
            { label: 'car', box: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 } },
            { label: 'wheel', box: { xmin: 0, ymin: 0, xmax: 30, ymax: 30 } },
        ];
        expect(findPlateBox(detections)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });
});
