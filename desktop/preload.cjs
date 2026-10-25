const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("beam", {
  platform: process.platform,
  action: (type, value) => ipcRenderer.invoke("action", { type, value }),
  filePath: (file) => webUtils.getPathForFile(file),
  onState: (fn) => ipcRenderer.on("state", (_, data) => fn(data)),
  onAnimation: (fn) => ipcRenderer.on("animation", (_, data) => fn(data)),
});
