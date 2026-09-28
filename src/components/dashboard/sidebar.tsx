"use client";

import { useState } from "react";
import { BarChart3, ChevronRight, Facebook, Instagram, Link2, Menu, MessageCircle, Moon, Music2, Sparkles, Sun, X, Youtube } from "lucide-react";
import Link from "next/link";
import { type PlatformKey } from "@/lib/dashboard-data";

type DashboardSection = "overview" | "coach" | "connections" | PlatformKey;

const themeStorageKey = "patsmemoir-dashboard-theme";

const navigation = [
  { label: "Overview", href: "/", icon: BarChart3, section: "overview" as const },
  { label: "Growth Coach", href: "/coach", icon: MessageCircle, section: "coach" as const },
  { label: "Connections", href: "/settings/connections", icon: Link2, section: "connections" as const },
];

const platformNavigation = [
  { label: "YouTube", href: "/youtube", icon: Youtube, section: "youtube" as const },
  { label: "Instagram", href: "/instagram", icon: Instagram, section: "instagram" as const },
  { label: "Facebook", href: "/facebook", icon: Facebook, section: "facebook" as const },
  { label: "TikTok", href: "/tiktok", icon: Music2, section: "tiktok" as const },
];

export function Sidebar({ activeSection = "overview" }: { activeSection?: DashboardSection }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "night" : "light";

    document.documentElement.dataset.theme = nextTheme;

    try {
      window.localStorage.setItem(themeStorageKey, nextTheme);
    } catch {
      // The visual preference still applies when browser storage is unavailable.
    }
  }

  return (
    <aside className={mobileMenuOpen ? "sidebar sidebar-mobile-open" : "sidebar"}>
      <div className="sidebar-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="brand-name">PatsMemoir</p>
            <p className="brand-caption">Creator dashboard</p>
          </div>
        </div>

        <div className="sidebar-controls">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title="Toggle light and night mode"
            type="button"
          >
            <Moon className="theme-icon theme-icon-night" size={18} aria-hidden="true" />
            <Sun className="theme-icon theme-icon-light" size={18} aria-hidden="true" />
            <span className="visually-hidden theme-label-night">Night mode active. Switch to light mode.</span>
            <span className="visually-hidden theme-label-light">Light mode active. Switch to night mode.</span>
          </button>

          <button
            aria-controls="dashboard-navigation"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
            className="mobile-nav-toggle"
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
            type="button"
          >
            {mobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <nav className="nav-list" id="dashboard-navigation" aria-label="Main navigation">
        <p className="nav-label">Workspace</p>
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.section;

          return (
            <Link aria-current={active ? "page" : undefined} className={`nav-item ${active ? "nav-item-active" : ""}`} href={item.href} key={item.label} onClick={() => setMobileMenuOpen(false)}>
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {active && <ChevronRight className="nav-chevron" size={16} aria-hidden="true" />}
            </Link>
          );
        })}

        <p className="nav-label nav-label-platforms">Platforms</p>
        {platformNavigation.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.section;

          return (
            <Link aria-current={active ? "page" : undefined} className={`nav-item ${active ? "nav-item-active" : ""}`} href={item.href} key={item.label} onClick={() => setMobileMenuOpen(false)}>
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {active && <ChevronRight className="nav-chevron" size={16} aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="profile-row">
          <div className="profile-avatar" aria-hidden="true">PT</div>
          <div>
            <p className="profile-name">Patrick Taylor</p>
            <p className="profile-handle">@patstaylor</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
