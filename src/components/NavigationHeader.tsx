"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  ShieldCheck, 
  LayoutDashboard, 
  FileText, 
  Users, 
  Inbox, 
  LogOut,
  Sparkles
} from "lucide-react";

export default function NavigationHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function checkUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    checkUser();
  }, [supabase]);

  // If on login page, don't show full navigation tabs
  if (pathname === "/login") {
    return (
      <header className="border-b border-[#1F2433] bg-[#0C0E16]/90 backdrop-blur sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-wide text-white font-mono">
                SESHANK AI LABS
              </span>
              <span className="text-[10px] tracking-wider text-slate-400 uppercase">
                Executive Dispatch OS
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Gate Locked</span>
          </div>
        </div>
      </header>
    );
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const navItems = [
    { href: "/", label: "Command Center", icon: LayoutDashboard },
    { href: "/content", label: "Content Studio", icon: FileText },
    { href: "/leads", label: "Lead Engine", icon: Users },
    { href: "/queue", label: "Queue & Vault", icon: Inbox },
  ];

  return (
    <header className="border-b border-[#1F2433] bg-[#0C0E16]/90 backdrop-blur sticky top-0 z-50 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Brand & Identity */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-wide text-white font-mono">
              SESHANK AI LABS
            </span>
            <span className="text-[10px] tracking-wider text-slate-400 uppercase">
              Internal Dispatch Center
            </span>
          </div>
        </div>

        {/* 4 Main OS Navigation Tabs */}
        <nav className="flex items-center space-x-1 bg-[#131722] border border-[#232838] p-1 rounded-xl">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 font-semibold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-[#1A1F2E]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Executive User Pill & Actions */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="hidden sm:flex items-center space-x-2 bg-[#121520] border border-[#232838] px-3 py-1.5 rounded-lg text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="text-slate-300 truncate max-w-[180px]">
              {userEmail || "seshank@seshankailabs.com"}
            </span>
          </div>

          <button
            onClick={handleLogout}
            title="Sign out"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#232838] bg-[#121520] text-slate-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
