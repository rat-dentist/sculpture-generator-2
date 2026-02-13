const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  saveSvg: (payload) => ipcRenderer.invoke("save-svg", payload),
  saveStl: (payload) => ipcRenderer.invoke("save-stl", payload)
});
