import { describe, expect, it } from 'vitest';
import { buildGrepMatcher, formatGrepMatches, isTextFilePath, type AgentGrepResult } from '../services/agentLocalGrep';

describe('local grep', () => {
  it('treats only text-like paths as searchable', () => {
    expect(isTextFilePath('notes.md')).toBe(true);
    expect(isTextFilePath('shots.srt')).toBe(true);
    expect(isTextFilePath('prompt.JSON')).toBe(true);
    expect(isTextFilePath('clip.mp4')).toBe(false);
    expect(isTextFilePath('README')).toBe(false);
  });

  it('uses a regex, ignores case when asked, and falls back to a literal pattern', () => {
    expect(buildGrepMatcher('龙\\s+喷火', true)('龙 喷火')).toBe(true);
    expect(buildGrepMatcher('DRAGON', false)('a dragon flies')).toBe(true);
    expect(buildGrepMatcher('DRAGON', true)('a dragon flies')).toBe(false);
    expect(buildGrepMatcher('C++ (', true)('uses C++ (fast)')).toBe(true);
  });

  it('groups matches by file and notes truncation', () => {
    const result: AgentGrepResult = {
      matches: [
        { folderId: 'f1', folderName: '素材', path: 'refs/a.srt', line: 2, text: '龙 喷火' },
        { folderId: 'f1', folderName: '素材', path: 'refs/a.srt', line: 9, text: '龙 抬头' },
        { folderId: 'f1', folderName: '素材', path: 'notes.md', line: 1, text: '龙设定' },
      ],
      scannedFiles: 12,
      truncated: true,
      skippedFolders: [],
      missingFolders: false,
    };
    const text = formatGrepMatches(result);
    expect(text).toContain('[素材/refs/a.srt]\n*2|龙 喷火\n*9|龙 抬头');
    expect(text).toContain('[素材/notes.md]');
    expect(text).toContain('结果已截断');
  });

  it('explains when no folder is connected', () => {
    const text = formatGrepMatches({ matches: [], scannedFiles: 0, truncated: false, skippedFolders: [], missingFolders: true });
    expect(text).toContain('没有已连接的本地文件夹');
  });
});
