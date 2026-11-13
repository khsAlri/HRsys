import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { db } from "@/lib/db";
import { defaultCriteria, defaultStages } from "@/lib/domain";
import { createCohort } from "@/app/actions";
import { Notice } from "@/components/notice";
import { LogoutButton } from "@/components/account-buttons";

export default async function AdminPage({
  searchParams
}: {
  searchParams: { error?: string; success?: string };
}) {
  const actor = await requireAdmin();
  const courses = await db.course.findMany({
    where: { ownerId: actor.id },
    include: {
      cohorts: {
        include: {
          enrollments: {
            select: { submissionState: true, gradedAt: true }
          }
        },
        orderBy: { createdAt: "desc" }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="stack">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1>관리자 대시보드</h1>
          <p className="muted mt-2">{actor.name}님의 담당 과정만 표시합니다.</p>
        </div>
        <LogoutButton />
      </header>

      <Notice {...searchParams} />

      <div className="notice">
        관리자 세션은 로그인 후 최대 15분입니다. 중요 작업은 비밀번호 재인증이 필요합니다.
        현재 버전은 로컬 개발·가상 데이터 검증용입니다.
      </div>

      <section className="stack">
        <h2>담당 기수</h2>
        {!courses.length && <p className="card muted">생성한 과정이 없습니다.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {courses.flatMap((course) =>
            course.cohorts.map((cohort) => (
              <Link
                key={cohort.id}
                className="card block space-y-2 hover:no-underline"
                href={`/admin/cohorts/${cohort.id}`}
              >
                <span className="badge">{cohort.state}</span>
                <h3>{course.name} · {cohort.name}</h3>
                <p className="muted">
                  참여 {cohort.enrollments.length}명 · 제출{" "}
                  {cohort.enrollments.filter(
                    (row) => row.submissionState === "SUBMITTED"
                  ).length}명 · 채점{" "}
                  {cohort.enrollments.filter((row) => row.gradedAt).length}명
                </p>
              </Link>
            ))
          )}
        </div>
      </section>

      <form action={createCohort} className="card stack">
        <h2>과정 · 첫 기수 생성</h2>
        <p className="muted">
          1차 MVP에서는 과정과 첫 기수를 함께 생성합니다.
          평가 기준은 생성 즉시 v1로 고정되며 기존 기준을 수정하는 기능은 제공하지 않습니다.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <label>
            과정명
            <input name="courseName" maxLength={120} required />
          </label>
          <label>
            교육 분야
            <input name="field" maxLength={120} required />
          </label>
        </div>
        <label>
          과정 설명
          <textarea name="description" maxLength={4000} required />
        </label>
        <label>
          학습 목표
          <textarea name="goal" maxLength={4000} required />
        </label>
        <label>
          기수명
          <input name="name" maxLength={120} required />
        </label>
        <label>
          진단 · 제출 안내
          <textarea name="instructions" maxLength={10000} required />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label>
            모집 종료 일시 — UTC
            <input
              name="joinUntil"
              placeholder="2027-01-01T00:00:00Z"
              required
              pattern=".*Z"
            />
          </label>
          <label>
            제출 마감 일시 — UTC
            <input
              name="deadline"
              placeholder="2027-01-07T00:00:00Z"
              required
              pattern=".*Z"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label>
            목표 그룹 인원
            <input name="target" type="number" min={1} max={100} defaultValue={5} required />
          </label>
          <label>
            최소 그룹 인원
            <input name="min" type="number" min={1} max={100} defaultValue={3} required />
          </label>
          <label>
            최대 그룹 인원
            <input name="max" type="number" min={1} max={100} defaultValue={6} required />
          </label>
        </div>

        <details open className="stack">
          <summary className="cursor-pointer font-semibold">평가 기준 설정</summary>
          <p className="muted">
            항목 ID는 영문 소문자로 시작하며 영문 소문자·숫자·밑줄만 사용합니다.
            가중치 합계는 100입니다. required는 필수 채점, grouping은 배정 반영 여부입니다.
          </p>
          <label>
            평가 항목 JSON
            <textarea
              name="criteria"
              rows={22}
              className="font-mono"
              defaultValue={JSON.stringify(defaultCriteria, null, 2)}
              required
            />
          </label>
          <label>
            학습 단계 JSON
            <textarea
              name="stages"
              rows={12}
              className="font-mono"
              defaultValue={JSON.stringify(defaultStages, null, 2)}
              required
            />
          </label>
          <p className="muted">
            단계 구간은 하한 포함·상한 미포함이며 마지막 구간만 100점을 포함합니다.
          </p>
        </details>

        <button className="w-fit">과정 · 기수 생성 후 모집 시작</button>
      </form>
    </div>
  );
}
