// 字体选择：内置 / 网页字体（中文优先）/ 本机字体（queryLocalFonts，点一下授权后列出）。选中即按需加载。
import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_FONTS, WEB_FONTS, canQuerySystemFonts, loadCutFont, querySystemFonts, type CutFontOption } from '../../services/cut/fonts';

type Lang = 'zho' | 'en';

export function CutFontPicker({ language, value, onChange }: { language: Lang; value?: string; onChange: (family: string) => void }) {
  const zh = language === 'zho';
  const [system, setSystem] = useState<CutFontOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (value) void loadCutFont(value); }, [value]);
  const groups = useMemo(() => [
    { label: zh ? '中文 / 网页字体（按需下载）' : 'Web fonts (downloaded on use)', fonts: WEB_FONTS },
    { label: zh ? '常用系统字体' : 'Common system fonts', fonts: BUILTIN_FONTS },
    ...(system.length ? [{ label: zh ? `本机字体（${system.length}）` : `Installed fonts (${system.length})`, fonts: system }] : []),
  ], [system, zh]);
  const known = groups.some(group => group.fonts.some(font => font.family === value));
  return (
    <div className="cut-font">
      <select
        className="cut-select cut-font__select"
        value={value || 'system-ui'}
        aria-label={zh ? '字体' : 'Font'}
        onChange={event => { const family = event.target.value; void loadCutFont(family).then(() => onChange(family)); onChange(family); }}
        style={{ fontFamily: value ? `"${value}", system-ui` : undefined }}
        data-testid="cut-font-select"
      >
        {!known && value && <option value={value}>{value}</option>}
        {groups.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.fonts.map(font => <option key={`${font.source}:${font.family}`} value={font.family}>{font.label}</option>)}
          </optgroup>
        ))}
      </select>
      {canQuerySystemFonts() && !system.length && (
        <button type="button" className="iris-ghost-pill cut-pill" disabled={loading} onClick={() => { setLoading(true); void querySystemFonts().then(list => { setSystem(list); setLoading(false); }); }}>
          {zh ? '读取本机字体' : 'Load installed fonts'}
        </button>
      )}
    </div>
  );
}
