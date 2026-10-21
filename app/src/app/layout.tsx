import type { Metadata } from "next";
import "./globals.css";
import "./app.css";
import "./crisis.css";
import "./social.css";
import "./vacancy.css";
import "./cloud.css";

export const metadata: Metadata = {
  title: "AI SkillBridge",
  description: "Capability intelligence: discover, connect and activate hidden capability, measured in dollars.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
