const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('qvoiceSettings', {
  getSettings:  ()  => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  checkModels:  ()  => ipcRenderer.invoke('check-models'),
  downloadModel: (repo, modelKey) => ipcRenderer.send('download-model', { repo, modelKey }),
  onDownloadProgress: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },
  completeOnboarding: (s) => ipcRenderer.invoke('complete-onboarding', s),
})
