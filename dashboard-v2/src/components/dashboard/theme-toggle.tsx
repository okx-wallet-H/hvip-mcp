import { useEffect, useState } from "react"
import { Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light")

  useEffect(() => {
    const stored = localStorage.getItem("theme-v2") as "light" | "dark" | null
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    const initial = stored || prefers
    setTheme(initial)
    document.documentElement.classList.toggle("dark", initial === "dark")
  }, [])

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    localStorage.setItem("theme-v2", next)
    document.documentElement.classList.toggle("dark", next === "dark")
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8 rounded-lg" aria-label="Toggle theme">
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
