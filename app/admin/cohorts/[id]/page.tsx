import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/access";
import {
  holdingReasons,
  stageName,
  totalScore,
  validateConfig,
  validateGroups,
  type Group,
  type Scores,
  type Snapshot
} from "@/lib/domain";
import {
  generateAssignment,
  grade,
  moveMember,
  operateCohort,
  publishAssignment
} from "@/app/actions";
import { Notice } from "@/components/notice";

export default async function AdminCohortPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string; success?: string };
}) {
  const actor = await requireAdmin();

  const cohort = await db.cohort.findFirst({
    where: { id: params.id, course: { ownerId: actor.id } },
    include: {
      course: true,
      enrollments: {
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" }
      },
      assignments: { orderBy: { createdAt: "desc" } },
      audits: { orderBy: { createdAt: "desc" }, take: 50 }
    }
  });

  if (!cohort) notFound();

  const { criteria, stages } = validateConfig(cohort.criteria, cohort.stages);
  const submitted = cohort.enrollments.filter(
    (row) => row.submissionState === "SUBMITTED"
  ).length;
  const graded = cohort.enrollments.filter((row) => row.gradedAt).length;
  const names = new Map(cohort.enrollments.map((row) => [row.id, row.user.name]));
  const gradeAllowed = ["GRADING", "REVIEW"].includes(cohort.state);

  return (
    <div className="stack">
      <header className="stack">
        <span className="badge w-fit">{cohort.state}</span>
        <h1>{cohort.course.name} · {cohort.name}</h1>
        <p className="muted">
          참여 {cohort.enrollments.length}명 · 제출 {submitted}명 · 채점 {graded}명
        </p>
      </header>

      <Notice {...searchParams} />

      <section className="card stack">
        <h2>운영 정보</h2>
        <p>참여 코드: <strong className="font-mono">{cohort.joinCode}</strong></p>
        <p className="muted">
          코드 {cohort.codeActive ? "활성" : "비활성"} · 모집 종료{" "}
          {cohort.joinUntil.toISOString()} · 제출 마감 {cohort.deadline.toISOString()}
        </p>
        <p className="muted">
          평가 기준 v{cohort.criteriaVersion} · 그룹 최소 {cohort.minSize} /
          목표 {cohort.targetSize} / 최대 {cohort.maxSize}
        </p>
        <p className="whitespace-pre-wrap">{cohort.instructions}</p>

        <form action={operateCohort} className="stack rounded-lg bg-slate-50 p-4">
          <input name="cohortId" type="hidden" value={cohort.id} />
          <label>
            운영 작업
            <select name="operation">
              <option value="disable-code">참여 코드 비활성화</option>
              <option value="start-grading">모집·제출 종료 및 채점 시작</option>
              <option value="close">공개된 기수 종료</option>
            </select>
          </label>
          <p className="muted">
            채점을 시작하면 마감 전이라도 추가 참여·답안 제출이 차단됩니다.
          </p>
          <label>
            작업 사유
            <input name="reason" maxLength={2000} required />
          </label>
          <label>
            현재 비밀번호 재인증
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="w-fit">운영 작업 적용</button>
        </form>
      </section>

      <section className="card stack">
        <h2>결과 분석</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>항목</th>
                <th>채점 인원</th>
                <th>평균 환산 점수</th>
                <th>최저 / 최고</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((item) => {
                const values = cohort.enrollments.flatMap((row) => {
                  if (!row.gradedAt || !row.scores) return [];
                  const scores = row.scores as unknown as Scores;
                  return scores[item.id] === undefined
                    ? []
                    : [(scores[item.id] / item.max) * 100];
                });
                const average = values.length
                  ? values.reduce((sum, value) => sum + value, 0) / values.length
                  : null;

                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{values.length}</td>
                    <td>{average === null ? "—" : average.toFixed(2)}</td>
                    <td>
                      {values.length
                        ? `${Math.min(...values).toFixed(2)} / ${Math.max(...values).toFixed(2)}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        <h2>수강생 · 제출 · 채점</h2>
        {!cohort.enrollments.length && (
          <p className="card muted">참여한 수강생이 없습니다.</p>
        )}

        {cohort.enrollments.map((row) => {
          const scores = (row.scores ?? {}) as unknown as Scores;
          const total = row.gradedAt ? totalScore(criteria, scores) : null;
          const reasons = holdingReasons(criteria, row, cohort.criteriaVersion);
          const canGrade = gradeAllowed && row.submissionState === "SUBMITTED";

          return (
            <details className="card stack" key={row.id}>
              <summary className="cursor-pointer font-semibold">
                {row.user.name} · {row.user.email} · {row.submissionState}
                {" · "}{row.gradedAt ? "채점 완료" : "미채점"}
              </summary>
              <p className="muted">수강생 식별자: {row.id}</p>
              <p>
                종합: {total === null ? "산출 보류" : total.toFixed(2)}
                {" · "}{stageName(stages, total)}
              </p>
              <p className={reasons.length ? "notice" : "muted"}>
                {reasons.length ? `배정 보류 사유: ${reasons.join(", ")}` : "배정 가능"}
              </p>
              <h3>제출 답안</h3>
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4">
                {row.answer || "작성된 답안이 없습니다."}
              </p>
              <p className="muted">
                학습 선호: {Array.isArray(row.survey) ? row.survey.join(" / ") : "미응답"}
              </p>

              <form action={grade} className="stack">
                <input name="cohortId" type="hidden" value={cohort.id} />
                <input name="enrollmentId" type="hidden" value={row.id} />
                <input name="expectedVersion" type="hidden" value={row.resultVersion} />

                <div className="grid gap-4 md:grid-cols-2">
                  {criteria.map((item) => (
                    <label key={item.id}>
                      {item.name} / {item.max}점 {item.required ? "(필수)" : "(선택)"}
                      <span className="muted">{item.rubric}</span>
                      <input
                        name={`score-${item.id}`}
                        type="number"
                        min={0}
                        max={item.max}
                        step="any"
                        defaultValue={scores[item.id] ?? ""}
                        required={item.required}
                        disabled={!canGrade}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  피드백
                  <textarea
                    name="feedback"
                    maxLength={10000}
                    defaultValue={row.feedback}
                    disabled={!canGrade}
                  />
                </label>
                {canGrade && (
                  <>
                    <label>
                      채점 · 변경 사유
                      <input name="reason" maxLength={2000} required />
                    </label>
                    <button className="w-fit">검증 후 채점 완료</button>
                  </>
                )}
              </form>
            </details>
          );
        })}
      </section>

      <form action={generateAssignment} className="card stack">
        <h2>그룹 배정안 생성</h2>
        <input name="cohortId" type="hidden" value={cohort.id} />
        <p className="muted">
          항목별 역량 거리로 우선 배정하고 역량 거리가 동일한 경우 학습 선호를 비교합니다.
          미완료 대상은 보류하며 인원 조건을 충족하지 못하면 생성을 차단합니다.
        </p>
        <label>
          생성 · 재배정 사유
          <input name="reason" maxLength={2000} required />
        </label>
        <button
          className="w-fit"
          disabled={!["GRADING", "REVIEW", "PUBLISHED"].includes(cohort.state)}
        >
          새 배정안 생성
        </button>
      </form>

      <section className="stack">
        <h2>배정 검토 · 공개 이력</h2>

        {cohort.assignments.map((assignment) => {
          const groups = assignment.groups as unknown as Group[];
          const snapshot = assignment.snapshot as unknown as Snapshot;
          const held = assignment.held as unknown as {
            id: string;
            reasons: string[];
          }[];

          let groupError = "";
          try {
            validateGroups(
              groups,
              snapshot.inputs.map((item) => item.id),
              snapshot.limits
            );
          } catch (error) {
            groupError = error instanceof Error ? error.message : "배정 검증 실패";
          }

          const editable =
            assignment.state === "REVIEW" && cohort.state !== "CLOSED";

          return (
            <article className="card stack" key={assignment.id}>
              <div className="flex flex-wrap items-center gap-3">
                <h3>{assignment.createdAt.toISOString()}</h3>
                <span className="badge">{assignment.state}</span>
                {cohort.publishedAssignmentId === assignment.id && (
                  <span className="badge">현재 공개 중</span>
                )}
              </div>

              <p className="muted">
                {assignment.algorithmVersion} · 기준 v{snapshot.criteriaVersion}
                {" · "}설문 v{snapshot.surveyVersion}
              </p>
              <p className="muted">생성 사유: {assignment.reason}</p>
              {groupError && <p className="error">{groupError}</p>}

              <div className="grid gap-4 md:grid-cols-2">
                {groups.map((group) => {
                  const profiles = group.members.map((id) =>
                    snapshot.inputs.find((item) => item.id === id)
                  ).filter((item) => item !== undefined);

                  return (
                    <div key={group.id} className="rounded-lg border p-4">
                      <h3>{group.name} · {group.members.length}명</h3>
                      <ul className="mt-2 list-inside list-disc text-sm">
                        {group.members.map((id) => (
                          <li key={id}>{names.get(id) ?? id}</li>
                        ))}
                      </ul>
                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        {criteria.filter((item) => item.grouping).map((item) => {
                          const values = profiles.flatMap((profile) =>
                            profile.scores[item.id] === undefined
                              ? []
                              : [(profile.scores[item.id] / item.max) * 100]
                          );
                          return (
                            <p key={item.id}>
                              {item.name} 환산 범위: {values.length
                                ? `${Math.min(...values).toFixed(1)}~${Math.max(...values).toFixed(1)}`
                                : "미산출"}
                            </p>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {held.length > 0 && (
                <div className="notice">
                  <h3>보류 대상</h3>
                  <ul className="mt-2 list-inside list-disc">
                    {held.map((item) => (
                      <li key={item.id}>
                        {names.get(item.id) ?? item.id}: {item.reasons.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {editable && (
                <>
                  <form action={moveMember} className="stack rounded-lg bg-slate-50 p-4">
                    <input name="cohortId" type="hidden" value={cohort.id} />
                    <input name="assignmentId" type="hidden" value={assignment.id} />
                    <h3>구성원 수동 이동</h3>
                    <p className="muted">
                      교환을 위해 검토 중에는 일시적 인원 위반을 허용합니다.
                      확정 시에는 모든 인원 조건을 만족해야 합니다.
                      이동 후 갱신된 그룹별 점수 범위를 확인하세요.
                    </p>
                    <label>
                      이동할 수강생
                      <select name="enrollmentId" required>
                        {groups.flatMap((group) =>
                          group.members.map((id) => (
                            <option key={id} value={id}>
                              {group.name} / {names.get(id) ?? id}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    <label>
                      대상 그룹
                      <select name="targetGroupId" required>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      이동 사유
                      <input name="reason" maxLength={2000} required />
                    </label>
                    <button className="w-fit">이동 후 재검토</button>
                  </form>

                  <form action={publishAssignment} className="stack border-t pt-5">
                    <input name="cohortId" type="hidden" value={cohort.id} />
                    <input name="assignmentId" type="hidden" value={assignment.id} />
                    <h3>확정 및 공개</h3>
                    <p className="muted">
                      입력 결과 버전·대상자 중복·누락·인원 조건을 다시 검증합니다.
                      공개하면 수강생 본인 평가와 그룹이 함께 공개됩니다.
                    </p>
                    {held.length > 0 && (
                      <label className="flex-row items-start">
                        <input
                          name="acknowledgeHeld"
                          type="checkbox"
                          className="mt-1"
                          required
                        />
                        보류 대상과 사유를 확인했습니다.
                      </label>
                    )}
                    <label>
                      확정 · 공개 사유
                      <input name="reason" maxLength={2000} required />
                    </label>
                    <label>
                      현재 비밀번호 재인증
                      <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                      />
                    </label>
                    <button className="w-fit" disabled={Boolean(groupError)}>
                      검증 후 확정 · 공개
                    </button>
                  </form>
                </>
              )}
            </article>
          );
        })}
      </section>

      <section className="card stack">
        <h2>최근 변경 이력</h2>
        <p className="muted">
          최근 50건만 표시합니다. 이전 기록은 데이터베이스에 유지됩니다.
        </p>
        <ul className="space-y-3 text-sm">
          {cohort.audits.map((event) => (
            <li key={event.id} className="border-b pb-3">
              <p>{event.createdAt.toISOString()} · {event.action}</p>
              <p className="muted">실행자: {event.actorId}</p>
              <details>
                <summary className="cursor-pointer text-indigo-700">변경 내용</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3 text-xs">
                  {JSON.stringify(event.detail, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
