import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/db";
import { joinCohort } from "@/app/actions";
import { Notice } from "@/components/notice";
import { LogoutButton } from "@/components/account-buttons";

export default async function HomePage({
  searchParams
}: {
  searchParams: { error?: string; success?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return (
      <section className="card stack">
        <span className="badge w-fit">학습 지원 플랫폼</span>
        <h1>진단부터 학습 그룹 배정까지</h1>
        <p className="text-slate-600">
          진단 답안과 학습 선호를 제출하면, 관리자가 평가하고 학습 그룹을 안내합니다.
          자동 생성된 배정안은 관리자 확정 전에는 공개되지 않습니다.
        </p>
        <Link className="button w-fit" href="/login">로그인 · 회원가입</Link>
      </section>
    );
  }

  const actor = await requireUser();
  const enrollments = await db.enrollment.findMany({
    where: { userId: actor.id },
    include: { cohort: { include: { course: true } } },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="stack">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1>{actor.name}님의 학습 홈</h1>
          <p className="muted mt-2">{actor.email}</p>
        </div>
        <LogoutButton />
      </div>

      <Notice {...searchParams} />

      {actor.role === "ADMIN" ? (
        <section className="card stack">
          <h2>관리자 계정</h2>
          <p className="muted">
            관리자 계정으로 수강생 답안을 제출하지 않습니다.
            테스트 제출은 별도의 수강생 계정을 사용하세요.
          </p>
          <Link className="button w-fit" href="/admin">관리자 대시보드</Link>
        </section>
      ) : (
        <form action={joinCohort} className="card stack">
          <h2>참여 코드로 기수 참여</h2>
          <label>
            참여 코드
            <input name="code" maxLength={40} autoComplete="off" required />
          </label>
          <button className="w-fit">참여하기</button>
        </form>
      )}

      <section className="stack">
        <h2>내 과정</h2>
        {!enrollments.length && (
          <p className="card muted">참여한 기수가 없습니다.</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {enrollments.map((row) => (
            <Link
              key={row.id}
              href={`/cohorts/${row.cohortId}`}
              className="card block space-y-2 hover:no-underline"
            >
              <span className="badge">{row.cohort.state}</span>
              <h3>{row.cohort.course.name} · {row.cohort.name}</h3>
              <p className="muted">{row.cohort.course.field}</p>
              <p className="muted">
                제출: {row.submissionState} · 채점: {row.gradedAt ? "완료" : "대기"}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
