import type { AppCard } from "./types";

/** Generic, familiar apps launchable from the Start menu (not search results). */
export const BUILTIN_APPS: AppCard[] = [
  { id: "settings", name: "Settings", icon: "⚙️", blurb: "System settings" },
  { id: "notepad", name: "Notepad", icon: "📝", blurb: "Plain-text editor" },
  { id: "calculator", name: "Calculator", icon: "🧮", blurb: "Crunch numbers" },
  { id: "browser", name: "Web Browser", icon: "🌐", blurb: "Browse the web" },
  { id: "files", name: "Files", icon: "📁", blurb: "File explorer" },
  { id: "paint", name: "Paint", icon: "🎨", blurb: "Draw and sketch" },
  { id: "music", name: "Music", icon: "🎵", blurb: "Play your tunes" },
  { id: "clock", name: "Clock", icon: "🕐", blurb: "Time and alarms" },
  { id: "terminal", name: "Terminal", icon: "⌨️", blurb: "Command line" },
  { id: "mail", name: "Mail", icon: "✉️", blurb: "Read your email" },
];
