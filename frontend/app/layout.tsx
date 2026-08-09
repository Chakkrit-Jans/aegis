import type { Metadata } from "next";
import "./globals.css";
import { LangProvider } from "./i18n";

export const metadata: Metadata = {
  title: "Aegis — Pentest Orchestration Console",
  description: "Authorized, human-in-the-loop AI pentest orchestration.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
