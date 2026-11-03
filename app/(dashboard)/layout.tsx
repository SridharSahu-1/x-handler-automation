import { Nav } from "@/components/nav";
import { logout } from "./actions";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-8 md:py-8">
      <aside className="md:w-44 md:shrink-0">
        <div className="mb-3 flex items-center justify-between md:mb-6 md:block">
          <div className="font-mono text-sm font-semibold">
            <span className="text-accent">$</span> x-handler
          </div>
          <form action={logout} className="md:mt-2">
            <button className="text-xs text-muted hover:underline">Log out</button>
          </form>
        </div>
        <Nav />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
