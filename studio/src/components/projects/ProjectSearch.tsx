import { Input } from "@xorkavi/arcade-gen";

export function ProjectSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search projects"
    />
  );
}
