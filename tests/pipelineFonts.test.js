import { afterEach, describe, expect, it } from 'vitest';
import { containsCjk, fontconfigCjkFont, resolveFontInfo, specNeedsCjk } from '../tools/flovart/pipeline/media.js';

const original = process.env.FLOVART_FONT_FILE;
afterEach(() => {
  if (original === undefined) delete process.env.FLOVART_FONT_FILE;
  else process.env.FLOVART_FONT_FILE = original;
});
const only = (...paths) => path => paths.includes(path);

describe('pipeline CJK font resolution', () => {
  it('detects Chinese, Japanese, Korean and full-width punctuation', () => {
    expect(containsCjk('截图进去')).toBe(true);
    expect(containsCjk('カタカナ')).toBe(true);
    expect(containsCjk('한국어')).toBe(true);
    expect(containsCjk('Hello，')).toBe(true);
    expect(containsCjk('Hello, world 123')).toBe(false);
    expect(specNeedsCjk({ tracks: { text: [{ text: 'Launch' }], captions: [{ displayText: '宣传片出来' }] } })).toBe(true);
    expect(specNeedsCjk({ tracks: { text: [{ text: 'Launch' }], captions: [] } })).toBe(false);
  });

  it('prefers the user font, then known CJK fonts, then fontconfig, and never silently falls back for Chinese', () => {
    delete process.env.FLOVART_FONT_FILE;
    const noFc = () => null;
    expect(resolveFontInfo({ requireCjk: true, exists: only('C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), fontconfig: noFc }))
      .toEqual({ path: 'C:/Windows/Fonts/msyh.ttc', cjk: true, source: 'system' });
    expect(resolveFontInfo({ requireCjk: true, exists: only('/opt/fonts/LXGW.ttf'), fontconfig: () => '/opt/fonts/LXGW.ttf' }))
      .toEqual({ path: '/opt/fonts/LXGW.ttf', cjk: true, source: 'fontconfig' });
    expect(resolveFontInfo({ requireCjk: false, exists: only('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), fontconfig: noFc }))
      .toEqual({ path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', cjk: false, source: 'fallback' });
    expect(() => resolveFontInfo({ requireCjk: true, exists: only('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), fontconfig: noFc }))
      .toThrow(expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE', details: expect.objectContaining({ capability: 'font' }) }));
    process.env.FLOVART_FONT_FILE = '/home/me/MyFont.otf';
    expect(resolveFontInfo({ requireCjk: true, exists: only('/home/me/MyFont.otf'), fontconfig: noFc })).toEqual({ path: '/home/me/MyFont.otf', cjk: true, source: 'env' });
    expect(() => resolveFontInfo({ exists: () => false, fontconfig: noFc })).toThrow(/FLOVART_FONT_FILE/);
  });

  it('picks a regular sans CJK face from fc-list output', () => {
    const stdout = [
      '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc: Noto Serif CJK SC:style=Regular',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc: Noto Sans CJK SC:style=Bold',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc: Noto Sans CJK SC:style=Regular',
      '/usr/share/fonts/opentype/noto/NotoSansMonoCJK-Regular.ttc: Noto Sans Mono CJK SC:style=Regular',
      '',
    ].join('\n');
    expect(fontconfigCjkFont(() => ({ status: 0, stdout }))).toBe('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc');
    expect(fontconfigCjkFont(() => ({ status: 1, stdout: '' }))).toBeNull();
    expect(fontconfigCjkFont(() => { throw new Error('ENOENT'); })).toBeNull();
  });
});
