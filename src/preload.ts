import { contextBridge, ipcRenderer } from "electron";

type AskPayload = {
  audioBuffer: ArrayBuffer;
  screenshotBuffer: ArrayBuffer;
};

contextBridge.exposeInMainWorld("api", {
  captureScreen: (): Promise<Uint8Array> => ipcRenderer.invoke("capture-screen"),
  askMargaret: (payload: AskPayload): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("ask-margaret", payload),
  resultReady: (): Promise<void> => ipcRenderer.invoke("result-ready"),
  tryAgain: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("try-again"),
  closeResult: (): Promise<void> => ipcRenderer.invoke("close-result"),
  onShowResult: (cb: (data: any) => void): void => {
    ipcRenderer.on("show-result", (_e, data) => cb(data));
  },
  quitApp: (): Promise<void> => ipcRenderer.invoke("quit-app"),
  saveApiKey: (key: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("save-api-key", key),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("open-external", url),
});
