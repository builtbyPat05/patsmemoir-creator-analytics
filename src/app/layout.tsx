import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "PatsMemoir | Creator dashboard",
  description: "A personal brand performance dashboard for PatsMemoir.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-theme="night" lang="en" suppressHydrationWarning>
      <body>
        <Script id="load-dashboard-theme" strategy="beforeInteractive">
          {`try {
            const theme = localStorage.getItem("patsmemoir-dashboard-theme");
            if (theme === "light" || theme === "night") {
              document.documentElement.dataset.theme = theme;
            }
          } catch {}`}
        </Script>
        {children}
      </body>
    </html>
  );
}
