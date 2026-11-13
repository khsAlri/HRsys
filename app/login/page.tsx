"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { register } from "@/app/actions";
import { LogoutButton } from "@/components/account-buttons";

function LoginForms() {
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const form = new FormData(event.currentTarget);
      const result = await signIn("credentials", {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        redirect: false
      });

      if (!result?.ok) {
        setError("로그인하지 못했습니다. 입력 정보를 확인하거나 잠시 후 재시도하세요.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("로그인 요청에 실패했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>로그인 · 회원가입</h1>
        <p className="muted mt-2">
          공개 회원가입으로는 수강생 계정만 생성됩니다.
        </p>
      </div>

      {params.get("expired") && (
        <p className="notice">
          관리자 세션 보안 시간이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}
      {params.get("success") && (
        <p className="notice">회원가입이 완료되었습니다. 로그인해 주세요.</p>
      )}
      {(error || params.get("error")) && (
        <p className="error" role="alert">{error || params.get("error")}</p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={login} className="card stack">
          <h2>로그인</h2>
          <label>
            이메일
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={pending}>{pending ? "확인 중…" : "로그인"}</button>
        </form>

        <form action={register} className="card stack">
          <h2>수강생 회원가입</h2>
          <label>
            이름
            <input name="name" maxLength={80} autoComplete="name" required />
          </label>
          <label>
            이메일
            <input
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
              required
            />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
            <span className="muted">12자 이상, UTF-8 기준 72바이트 이하</span>
          </label>

          <div className="notice">
            로컬 개발용 안내: 이름·이메일·답안·평가·학습 선호 응답을 학습 지원에
            사용합니다. 공개 운영 전 운영 주체, 보유 기간, 삭제·탈퇴 절차 및
            개인정보 문의처를 확정하고 실제 개인정보 처리방침으로 교체해야 합니다.
            현재 버전에는 실제 개인정보를 입력하지 마세요.
          </div>

          <label className="flex-row items-start">
            <input name="privacy" type="checkbox" required className="mt-1" />
            개발용 안내를 확인했으며 가상 정보로 이용합니다.
          </label>
          <button>수강생 계정 만들기</button>
        </form>
      </div>

      <div className="card flex items-center justify-between gap-4">
        <p className="muted">
          공용 기기에서 다른 계정을 사용하려면 먼저 로그아웃하세요.
        </p>
        <LogoutButton />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p>로그인 화면을 불러오는 중입니다.</p>}>
      <LoginForms />
    </Suspense>
  );
}
