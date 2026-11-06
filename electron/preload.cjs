const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vanoUpdate", {
  getState: () => ipcRenderer.invoke("vano-update-state"),
  install: () => ipcRenderer.invoke("vano-update-install"),
  onChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("vano-update", listener);
    return () => ipcRenderer.removeListener("vano-update", listener);
  },
});
