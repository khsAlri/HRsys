import { notFound } from "next/navigation";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/db";
import {
  holdingReasons,
  stageName,
  surveyLabels,
  totalScore,
  validateConfig,
  type Group,
  type Scores
} from "@/lib/domain";
import { saveSubmission } from "@/app/actions";
import { Notice } from "@/components/notice";

export default async function StudentCohortPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string; success?: string };
}) {
  const actor = await requireUser();

  const enrollment = await db.enrollment.findUnique({
    where: {
      cohortId_userId: { cohortId: params.id, userId: actor.id }
    },
    include: { cohort: { include: { course: true } } }
  });

  if (!enrollment) notFound();

  const cohort = enrollment.cohort;
  const { criteria, stages } = validateConfig(cohort.criteria, cohort.stages);
  const preferences = Array.isArray(enrollment.survey)
    ? enrollment.survey as number[]
    : [];
  const editable =
    actor.role === "STUDENT" &&
    cohort.state === "OPEN" &&
    cohort.deadline >= new Date() &&
    enrollment.submissionState !== "SUBMITTED";

  const assignment = cohort.publishedAssignmentId
    ? await db.assignment.findFirst({
        where: {
          id: cohort.publishedAssignmentId,
          cohortId: cohort.id,
          state: "CONFIRMED"
        }
      })
    : null;

  const ownGroup = assignment
    ? (assignment.groups as unknown as Group[]).find((group) =>
        group.members.includes(enrollment.id)
      )
    : undefined;

  const scores = enrollment.scores as unknown as Scores | null;
  const total = scores ? totalScore(criteria, scores) : null;
  const reasons = holdingReasons(criteria, enrollment, cohort.criteriaVersion);

  return (
    <div className="stack">
      <header className="stack">
        <span className="badge w-fit">{cohort.state}</span>
        <h1>{cohort.course.name} · {cohort.name}</h1>
        <p className="muted">{cohort.course.field}</p>
      </header>

      <Notice {...searchParams} />

      <section className="card stack">
        <h2>진단 안내</h2>
        <p className="whitespace-pre-wrap">{cohort.instructions}</p>
        <p className="muted">
          제출 마감: {cohort.deadline.toISOString()} · 평가 기준 v{cohort.criteriaVersion}
        </p>
        <p className="notice">
          1차 MVP는 텍스트 답안만 지원합니다. 최종 제출 후 수정 및 마감 후 제출은 허용하지 않습니다.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {criteria.map((item) => (
            <article key={item.id} className="rounded-lg bg-slate-50 p-4">
              <h3>{item.name} · {item.max}점 / 가중치 {item.weight}%</h3>
              <p className="muted mt-2">{item.purpose}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{item.rubric}</p>
            </article>
          ))}
        </div>
      </section>

      <form action={saveSubmission} className="card stack">
        <input name="cohortId" type="hidden" value={cohort.id} />
        <h2>답안 · 학습 선호</h2>
        <label>
          텍스트 답안
          <textarea
            name="answer"
            rows={12}
            maxLength={30000}
            defaultValue={enrollment.answer}
            disabled={!editable}
          />
        </label>

        <div className="notice">
          학습 선호는 우열이나 성격 진단이 아닙니다.
          1은 왼쪽 선호, 3은 중립, 5는 오른쪽 선호를 의미합니다.
        </div>

        {surveyLabels.map(([left, right], index) => (
          <label key={left}>
            {left} ↔ {right}
            <select
              name={`survey-${index}`}
              defaultValue={preferences[index] ?? ""}
              disabled={!editable}
              required
            >
              <option value="" disabled>선택해 주세요</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
          </label>
        ))}

        {editable ? (
          <div className="flex flex-wrap gap-3">
            <button name="intent" value="draft">임시 저장</button>
            <button name="intent" value="submit">최종 제출</button>
          </div>
        ) : (
          <p className="muted">
            제출 상태: {enrollment.submissionState}
            {enrollment.submittedAt && ` · ${enrollment.submittedAt.toISOString()}`}
          </p>
        )}
      </form>

      <section className="card stack">
        <h2>내 결과</h2>
        {!cohort.resultsPublished ? (
          <p className="muted">관리자가 결과를 공개하면 확인할 수 있습니다.</p>
        ) : !enrollment.gradedAt || !scores ? (
          <p className="muted">완료된 평가 결과가 없습니다.</p>
        ) : (
          <>
            <p>
              종합 점수: {total === null ? "산출 보류" : total.toFixed(2)}
              {" · "}{stageName(stages, total)}
            </p>
            <ul className="list-inside list-disc text-sm">
              {criteria.map((item) => (
                <li key={item.id}>
                  {item.name}: {scores[item.id] === undefined
                    ? "미채점"
                    : `${scores[item.id]} / ${item.max}`}
                </li>
              ))}
            </ul>
            <p className="whitespace-pre-wrap">
              {enrollment.feedback || "등록된 피드백이 없습니다."}
            </p>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>내 그룹</h2>
        {!assignment ? (
          <p className="muted">확정·공개된 그룹이 없습니다.</p>
        ) : ownGroup ? (
          <>
            <h3>{ownGroup.name}</h3>
            <p className="whitespace-pre-wrap">학습 목표: {cohort.course.goal}</p>
            <p className="muted">
              구성원 개인정보와 다른 수강생의 점수·설문 응답은 공개하지 않습니다.
              그룹 일정은 운영자가 별도로 안내합니다.
            </p>
          </>
        ) : (
          <div className="notice">
            배정 보류: {reasons.length ? reasons.join(", ") : "관리자에게 문의해 주세요."}
          </div>
        )}
      </section>
    </div>
  );
}
