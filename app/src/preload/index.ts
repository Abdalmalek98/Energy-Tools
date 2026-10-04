import { contextBridge, ipcRenderer } from "electron";

/** Narrow, explicit API. The renderer never sees the lease, the file system or the network. */
const api = {
  info: () => ipcRenderer.invoke("app:info"),
  license: {
    status: () => ipcRenderer.invoke("license:status"),
    activate: (code: string) => ipcRenderer.invoke("license:activate", code),
    check: () => ipcRenderer.invoke("license:check"),
    deactivate: () => ipcRenderer.invoke("license:deactivate"),
    onStatus: (cb: (s: unknown) => void) => { const h = (_e: unknown, s: unknown) => cb(s); ipcRenderer.on("license:status", h); return () => { ipcRenderer.removeListener("license:status", h); }; },
  },
  personal: { get: () => ipcRenderer.invoke("personal:get"), set: (p: unknown) => ipcRenderer.invoke("personal:set", p), test: () => ipcRenderer.invoke("personal:test") },
  settings: { get: () => ipcRenderer.invoke("settings:get"), set: (p: unknown) => ipcRenderer.invoke("settings:set", p) },
  files: { pick: () => ipcRenderer.invoke("files:pick") },
  read: { page: (images: ArrayBuffer[], quality: "best" | "fast", hint?: string) => ipcRenderer.invoke("read:page", images, quality, hint) },
  project: {
    save: (project: unknown, images: Record<string, ArrayBuffer>, path?: string) => ipcRenderer.invoke("project:save", project, images, path),
    open: (path?: string) => ipcRenderer.invoke("project:open", path),
    recent: () => ipcRenderer.invoke("project:recent"),
  },
  export: { run: (o: unknown) => ipcRenderer.invoke("export:run", o) },
  clipboard: { write: (text: string) => ipcRenderer.invoke("clipboard:write", text) },
  support: { open: () => ipcRenderer.invoke("support:open") },
  reveal: (p: string) => ipcRenderer.invoke("shell:reveal", p),
  updates: { check: () => ipcRenderer.invoke("updates:check") },
};
contextBridge.exposeInMainWorld("api", api);
export type Api = typeof api;
