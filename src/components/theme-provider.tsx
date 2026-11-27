import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      document.documentElement.classList.remove("theme-transitioning");
    },
    [],
  );
  useEffect(() => {
    try {
      const saved = localStorage.getItem("diario-theme");
      if (saved === "light" || saved === "dark") {
        setTheme(saved);
        document.documentElement.classList.toggle("dark", saved === "dark");
        document.documentElement.style.colorScheme = saved;
      }
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    document.documentElement.classList.add("theme-transitioning");
    // Commit the transition rules before changing the color tokens.
    void document.documentElement.offsetWidth;
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem("diario-theme", next);
    } catch {
      /* Keep the toggle functional. */
    }
    transitionTimer.current = setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 550);
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme requires ThemeProvider");
  return context;
}
