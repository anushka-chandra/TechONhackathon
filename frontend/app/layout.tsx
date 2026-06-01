import type { Metadata } from "next";
import { Geist, Geist_Mono, Sora, Inter } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import { ChatProvider } from "@/context/ChatContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Premium type pairing: Sora for headings, Inter for body.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clarity · AI Purchasing Society",
  description: "A Virtual Organization of Specialized AI Agents Simulating Procurement Outcomes",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col overflow-hidden app-shell">
        <ThemeProvider>
          <ProfileProvider>
            <ChatProvider>
              <NavBar />
              <div className="flex-1 flex flex-col min-w-0 overflow-auto">
                {children}
              </div>
            </ChatProvider>
          </ProfileProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
