// Mock for the native keytar module used in tests
export async function getPassword(service: string, account: string): Promise<string | null> {
  return null;
}

export async function setPassword(service: string, account: string, password: string): Promise<void> {
  // no-op
}

export async function deletePassword(service: string, account: string): Promise<boolean> {
  return false;
}
