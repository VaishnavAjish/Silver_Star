import type { Metadata } from "next";
import { Bodoni_Moda, Jost } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Grain } from "@/components/Grain";
import { CustomCursor } from "@/components/CustomCursor";
import { CartDrawer } from "@/components/CartDrawer";

const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-bodoni",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-jost",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Harene — High Jewellery Maison",
  description:
    "Harene is a high jewellery maison. Rings, necklaces, earrings and bracelets, cut from light and set by hand.",
  keywords: [
    "Harene",
    "high jewellery",
    "diamonds",
    "fine jewellery",
    "luxury rings",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodoni.variable} ${jost.variable}`}>
      <body>
        <Grain />
        <CustomCursor />
        <Header />
        <main>{children}</main>
        <Footer />
        <CartDrawer />
      </body>
    </html>
  );
}
