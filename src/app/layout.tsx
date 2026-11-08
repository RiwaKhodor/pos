import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";
import { isOwnerWeb } from "@/lib/host";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = isOwnerWeb()
  ? {
      title: "VANO German Store",
      description: "VANO German Store owner app",
      applicationName: "VANO German Store",
      icons: {
        icon: [
          { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { url: "/logo.png" },
        ],
        apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
      },
      appleWebApp: {
        capable: true,
        title: "VANO German Store",
        statusBarStyle: "default",
      },
    }
  : {
      title: "VANO POS",
      description: "VANO German Store point of sale",
      applicationName: "POS Owner Dashboard",
      icons: {
        icon: [
          { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { url: "/logo.png" },
        ],
        apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
      },
      appleWebApp: {
        capable: true,
        title: "POS",
        statusBarStyle: "default",
      },
    };

export const viewport: Viewport = isOwnerWeb()
  ? { themeColor: "#ffffff", colorScheme: "light" }
  : { themeColor: "#e8e8e8" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {isOwnerWeb() ? (
          <>
            <div id="app-splash" className="app-splash" suppressHydrationWarning>
              <p>VANO German Store</p>
            </div>
            <script
              dangerouslySetInnerHTML={{
                __html: `(function(){function hide(){var el=document.getElementById('app-splash');if(!el||el.dataset.hidden)return;el.dataset.hidden='1';el.classList.add('app-splash-hide');}if(document.readyState==='complete')hide();else window.addEventListener('load',hide);setTimeout(hide,12000);})();`,
              }}
            />
          </>
        ) : null}
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
