import { contextBridge, ipcRenderer } from "electron";

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.off(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld("oicq", {
  getState: async () => await ipcRenderer.invoke("oicq:get-state"),
  submitTask: async (payload: unknown) => await ipcRenderer.invoke("oicq:submit-task", payload),
  attachTerminal: async () => {
    await ipcRenderer.invoke("oicq:attach-terminal");
  },
  sendTerminalInput: (data: string) => {
    ipcRenderer.send("oicq:terminal-input", data);
  },
  resizeTerminal: (cols: number, rows: number) => {
    ipcRenderer.send("oicq:terminal-resize", { cols, rows });
  },
  onStateChanged: (listener: (payload: unknown) => void) => listen("oicq:state", listener),
  onTerminalData: (listener: (payload: string) => void) => listen<string>("oicq:terminal-data", listener),
  onTerminalExit: (listener: (payload: unknown) => void) => listen("oicq:terminal-exit", listener),
});
