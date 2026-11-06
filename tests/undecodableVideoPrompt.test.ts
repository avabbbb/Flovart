import { describe, expect, it } from 'vitest';
import { displayError } from '../services/displayError';
import { h264ConvertCommand } from '../services/undecodableVideoPrompt';

describe('undecodable video fallback', () => {
  it('builds an H.264 conversion command next to the source name', () => {
    expect(h264ConvertCommand('IMG_0422.MOV')).toBe(
      'ffmpeg -i "IMG_0422.MOV" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -movflags +faststart "IMG_0422-h264.mp4"',
    );
  });

  it('escapes quotes in file names', () => {
    expect(h264ConvertCommand('a"b.mov')).toContain('"a\\"b.mov"');
  });

  it('maps provider HTTP 422 to an actionable codec hint', () => {
    const message = displayError(new Error('RunningHub 请求失败 (422): Unprocessable Entity'));
    expect(message).toContain('换一个文件');
    expect(message).toContain('H.264');
  });
});
