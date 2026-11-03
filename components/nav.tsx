"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "Overview"],
  ["/drafts", "Drafts"],
  ["/posts", "Posts"],
  ["/analytics", "Analytics"],
  ["/calendar", "Calendar"],
  ["/trends", "Trends"],
  ["/replies", "Replies"],
  ["/voice", "Voice"],
  ["/profile", "Profile"],
  ["/settings", "Settings"],
  ["/logs", "Logs"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
      {LINKS.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active ? "bg-stone-500/15 font-medium" : "text-muted hover:bg-stone-500/10"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
