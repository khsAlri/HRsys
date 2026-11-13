import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "HRsys | 학습 그룹 배정",
  description: "학습 진단과 관리자 검토를 통한 교육 그룹 배정"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
            <Link href="/" className="text-xl font-bold">HRsys</Link>
            <div className="flex gap-5 text-sm">
              <Link href="/">수강생 홈</Link>
              <Link href="/admin">관리자</Link>
              <Link href="/login">로그인</Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 py-8 text-xs text-slate-500">
          평가 결과는 학습 지원 용도입니다. 채용·승진 등 인사평가에 자동 사용하지 않습니다.
        </footer>
      </body>
    </html>
  );
}
