"use client";

import { MoonStar, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const options = [
  { value: "pink", label: "Pink light", swatch: "#e74f91" },
  { value: "purple", label: "Purple dark", swatch: "#a875ff" },
  { value: "blue", label: "Blue dark", swatch: "#4ea8ff" },
  { value: "green", label: "Green dark", swatch: "#45d49c" },
  { value: "berry", label: "Berry dark", swatch: "#ef5f9a" },
  { value: "grey", label: "Grey dark", swatch: "#aeb4c0" },
];

export function ThemePicker({ iconOnly = false }: { iconOnly?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <Select value={theme ?? "pink"} onValueChange={setTheme}>
      <SelectTrigger
        className={iconOnly ? "theme-trigger theme-trigger-icon" : "theme-trigger"}
        aria-label="Choose colour theme"
      >
        {iconOnly ? <MoonStar aria-hidden="true" /> : <Palette aria-hidden="true" />}
        {!iconOnly && <SelectValue placeholder="Theme" />}
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span
              className="theme-swatch"
              style={{ backgroundColor: option.swatch }}
              aria-hidden="true"
            />
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
