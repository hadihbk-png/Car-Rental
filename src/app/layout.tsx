import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Suspense } from "react";
import { SessionHeader } from "@/components/layout/session-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s · DriveEasy",
    default: "DriveEasy · Car rental in the UAE",
  },
  description:
    "Rent a car in the UAE with DriveEasy. Compare vehicles by branch, dates and price in AED, add extras and get a digital pick-up voucher.",
  applicationName: "DriveEasy",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#146264",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" dir="ltr" className={`${jakarta.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SkipLink />
        <ToastProvider>
          <Suspense fallback={<SiteHeader user={null} pending />}>
            <SessionHeader />
          </Suspense>
          <main id="main" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
            {children}
          </main>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
