import { describe, it, expect } from 'vitest';
import { formatBytes } from './utils';

describe('formatBytes', () => {
    it('returns 0 B for 0', () => {
        expect(formatBytes(0)).toBe('0 B');
    });

    it('returns 0 B for negative', () => {
        expect(formatBytes(-100)).toBe('0 B');
    });

    it('returns 0 B for NaN', () => {
        expect(formatBytes(NaN)).toBe('0 B');
    });

    it('formats bytes correctly', () => {
        expect(formatBytes(500)).toBe('500.0 B');
    });

    it('formats kilobytes correctly', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes correctly', () => {
        expect(formatBytes(1048576)).toBe('1.0 MB');
        expect(formatBytes(44000000)).toBe('42.0 MB');
    });

    it('formats gigabytes correctly', () => {
        expect(formatBytes(1073741824)).toBe('1.0 GB');
    });
});
