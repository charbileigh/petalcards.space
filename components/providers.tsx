"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "sonner";

const themes = ["pink", "purple", "blue", "green", "berry", "grey"];

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="pink"
      enableSystem={false}
      storageKey="petalcards-theme"
      themes={themes}
    >
      {children}
      <PetalToaster />
    </ThemeProvider>
  );
}

function PetalToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      richColors
      position="bottom-right"
      theme={theme === "pink" ? "light" : "dark"}
      toastOptions={{
        style: {
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          borderColor: "var(--border)",
        },
      }}
    />
  );
}
