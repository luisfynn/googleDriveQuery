import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "단가 검색기 · Price Lens",
  description: "Google Drive에 흩어진 단가 자료를 한 번에 검색합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
