import { describe, expect, it } from 'vitest';
import { prepareOrderedMediaFiles, sanitizeMediaFileStem } from '../utils/batchMediaExport';

describe('batch media export', () => {
  it('sorts by canvas position and prefixes stable ordered filenames', () => {
    const files = prepareOrderedMediaFiles([
      { id: 'c', x: 10, y: 200, name: '尾图', mimeType: 'image/webp', loadBlob: async () => new Blob() },
      { id: 'b', x: 180, y: 20, name: '右图', mimeType: 'image/png', loadBlob: async () => new Blob() },
      { id: 'a', x: 20, y: 20, name: '左图', mimeType: 'image/jpeg', loadBlob: async () => new Blob() },
    ]);
    expect(files.map(file => file.fileName)).toEqual(['001_左图.jpg', '002_右图.png', '003_尾图.webp']);
  });

  it('keeps readable unicode while removing invalid filename characters', () => {
    expect(sanitizeMediaFileStem(' 人像:夏日/01?* ', '图片')).toBe('人像_夏日_01');
    expect(sanitizeMediaFileStem('... ', '图片')).toBe('图片');
  });
});
