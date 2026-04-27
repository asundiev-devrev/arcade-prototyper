/**
 * Generates stub implementations for DevRev API helpers.
 * Used when bundling frames for deployment to ensure no PATs are embedded.
 */

export function generateDevRevStubs(): string {
  return `
// DevRev API stubs for static deployment
export function createDevRevClient() {
  console.warn("[Deployed Frame] DevRev API calls are stubbed with mock data");

  return {
    async getWorks() {
      return { works: [] };
    },
    async getWork(id: string) {
      return { id, title: "Sample Work", stage: { name: "In Progress" } };
    },
    async getParts() {
      return { parts: [] };
    },
    async getPart(id: string) {
      return { id, name: "Sample Part" };
    },
    async getCurrentUser() {
      return { id: "demo-user", display_name: "Demo User" };
    },
  };
}
`;
}
