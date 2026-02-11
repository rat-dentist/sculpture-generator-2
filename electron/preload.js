const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  saveSvg: (payload) => ipcRenderer.invoke("save-svg", payload)
});