// Mock vscode module for tests
export const ViewColumn = {
  Active: -1,
} as const;

export const window = {
  createWebviewPanel: () => {
    throw new Error("vscode.window.createWebviewPanel should not be called in unit tests");
  },
};
