import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

export type ResolvedTheme = 'light' | 'dark';

/** Follow the app theme (including DSH embed, where the host drives themeMode). */
export function useResolvedTheme(): ResolvedTheme {
  const themeMode = useWorkspaceStore(s => s.themeMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => (
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  ));
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const sync = () => setSystemTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return themeMode === 'system' ? systemTheme : themeMode;
}
