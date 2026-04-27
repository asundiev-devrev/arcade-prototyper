export function placeholderTint(theme: "arcade" | "devrev-app"): string {
  return theme === "arcade"
    ? "linear-gradient(135deg, #F5F2EF, #E6DFD6)"
    : "linear-gradient(135deg, #E8EEFB, #D3DEF4)";
}
