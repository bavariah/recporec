import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Речоград — српска игра речи",
  description:
    "Брза стратешка игра речи на српском језику, направљена за прегледач.",
  applicationName: "Речоград",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Речоград",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#17251e",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sr-Cyrl">
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
