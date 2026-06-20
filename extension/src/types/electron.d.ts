// Type augmentation for Electron-specific process properties
// The extension runs in VS Code which is also Electron-based

declare global {
  namespace NodeJS {
    interface Process {
      resourcesPath?: string;
    }
  }
}

export {};
