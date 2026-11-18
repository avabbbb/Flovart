import { describe, expect, it } from 'vitest';
import { userAttachmentThumbs, withoutAttachmentLine } from '../components/agent/agentTurnText';

describe('用户附件缩略图', () => {
  it('按「已附带画面」备注取本地附件的图片块（视频取首帧）', () => {
    const text = '看看这个\n\n已附带画面：\n本地图片「a.png」\n本地视频「b.mp4」首/中/尾帧';
    const images = [
      { mimeType: 'image/png', data: 'AAA' },
      { mimeType: 'image/jpeg', data: 'B1' }, { mimeType: 'image/jpeg', data: 'B2' }, { mimeType: 'image/jpeg', data: 'B3' },
    ];
    const thumbs = userAttachmentThumbs(text, images);
    expect(thumbs.map(t => t.name)).toEqual(['a.png', 'b.mp4']);
    expect(thumbs[0].previewUrl).toBe('data:image/png;base64,AAA');
    expect(thumbs[1].previewUrl).toBe('data:image/jpeg;base64,B1');
    expect(withoutAttachmentLine('看看这个\n\n附件：a.png')).toBe('看看这个');
  });
});
