/** File access: native dialogs under Tauri, <input>/download fallback in a plain browser (dev only). */

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface PickedFile { name: string; path?: string; bytes: Uint8Array; }

export async function pickFiles(opts: { extensions: string[]; multiple?: boolean; title?: string }): Promise<PickedFile[]> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const sel = await open({ multiple: !!opts.multiple, title: opts.title, filters: [{ name: 'Supported files', extensions: opts.extensions }, { name: 'All files', extensions: ['*'] }] });
    if (!sel) return [];
    const paths = Array.isArray(sel) ? sel : [sel];
    return Promise.all(paths.map(async (p) => ({ path: p, name: p.split(/[\\/]/).pop()!, bytes: await readFile(p) })));
  }
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = !!opts.multiple;
    inp.accept = opts.extensions.map((e) => `.${e}`).join(',');
    inp.onchange = async () => resolve(await Promise.all([...(inp.files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    inp.oncancel = () => resolve([]);
    inp.click();
  });
}

export async function saveFile(defaultName: string, bytes: Uint8Array, ext: string, title?: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: defaultName, title, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  }
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return defaultName;
}

export async function writeToPath(path: string, bytes: Uint8Array) {
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(path, bytes);
}
export async function readFromPath(path: string): Promise<Uint8Array> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return readFile(path);
}
