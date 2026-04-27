import { Switch } from "@xorkavi/arcade-gen";

export function ThemeToggle({
  mode,
  onToggle,
}: {
  mode: "light" | "dark";
  onToggle: () => void;
}) {
  return (
    <Switch
      checked={mode === "dark"}
      onCheckedChange={onToggle}
      label="Dark"
    />
  );
}
