import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react"
import { useIsMobile } from "@/hooks/use-mobile"

type SidebarState = "expanded" | "collapsed"

interface SidebarContextValue {
  state: SidebarState
  open: boolean
  setOpen: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider")
  return ctx
}

const COOKIE_NAME = "sidebar_state_v2"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function getCookie(name: string): boolean | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  if (!match) return null
  return match[1] === "true"
}

function setCookie(name: string, value: boolean) {
  document.cookie = `${name}=${value};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`
}

interface SidebarProviderProps {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function SidebarProvider({
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  children,
}: SidebarProviderProps) {
  const isMobile = useIsMobile()
  const [internalOpen, setInternalOpen] = useState(() => {
    if (defaultOpen !== undefined) return defaultOpen
    return getCookie(COOKIE_NAME) ?? true
  })

  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const state: SidebarState = open ? "expanded" : "collapsed"

  const setOpen = useCallback(
    (value: boolean) => {
      if (controlledOpen === undefined) {
        setInternalOpen(value)
        setCookie(COOKIE_NAME, value)
      }
      onOpenChange?.(value)
    },
    [controlledOpen, onOpenChange]
  )

  const toggleSidebar = useCallback(() => {
    setOpen(!open)
  }, [open, setOpen])

  // Keyboard shortcut: Cmd/Ctrl + B
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault()
        toggleSidebar()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [toggleSidebar])

  const value = useMemo<SidebarContextValue>(
    () => ({ state, open, setOpen, isMobile, toggleSidebar }),
    [state, open, setOpen, isMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  )
}
