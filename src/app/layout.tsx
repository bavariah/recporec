import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Slab } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import "./globals.css";

const inter = Inter({
  display: "swap",
  subsets: ["cyrillic", "cyrillic-ext", "latin"],
  variable: "--font-sans",
});

const robotoSlab = Roboto_Slab({
  display: "swap",
  subsets: ["cyrillic", "cyrillic-ext", "latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://recporec.vercel.app"),
  alternates: { canonical: "/" },
  title: "Шкрабај — српска игра речи",
  description:
    "Брза стратешка игра речи на српском језику, направљена за прегледач.",
  applicationName: "Шкрабај",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Шкрабај",
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
      <body className={`${inter.variable} ${robotoSlab.variable}`}>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
