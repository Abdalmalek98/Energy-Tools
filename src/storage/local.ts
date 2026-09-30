/** Small per-user convenience storage (recent projects, theme). Never holds engineering data. */
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export interface RecentProject { name: string; path: string; openedAt: string; }
export const loadRecent = (): RecentProject[] => { try { return JSON.parse(get('cpa.recent') ?? '[]'); } catch { return []; } };
export function pushRecent(r: RecentProject) {
  const list = [r, ...loadRecent().filter((x) => x.path !== r.path)].slice(0, 8);
  set('cpa.recent', JSON.stringify(list));
  return list;
}
export const loadTheme = (): 'light' | 'dark' | 'system' => (get('cpa.theme') as 'light' | 'dark' | 'system') ?? 'system';
export const saveTheme = (t: string) => set('cpa.theme', t);
export const loadPolicy = () => { try { return JSON.parse(get('cpa.policy') ?? 'null'); } catch { return null; } };
