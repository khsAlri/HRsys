"use server";

import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import {
  audit,
  reauthenticate,
  requireAdmin,
  requireUser,
  toJson,
  withCohort
} from "@/lib/access";
import { rateLimit } from "@/lib/rate-limit";
import {
  ALGORITHM_VERSION,
  SURVEY_VERSION,
  createGroups,
  surveySchema,
  validateConfig,
  validateGroups,
  validateLimits,
  validateScores,
  type Group,
  type Snapshot
} from "@/lib/domain";
import { assignmentInput } from "@/lib/assignment-input";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function password(form: FormData): string {
  const value = form.get("password");
  return typeof value === "string" ? value : "";
}

function required(form: FormData, name: string, maximum = 1000): string {
  return z.string().min(1).max(maximum).parse(text(form, name));
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return "입력 형식 또는 범위를 확인해 주세요.";
  }
  if (error instanceof SyntaxError) {
    return "JSON 형식이 올바르지 않습니다.";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002"
      ? "이미 등록된 정보가 있습니다."
      : "데이터 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다.";
}

async function perform(
  destination: string,
  work: () => Promise<void>
): Promise<never> {
  let message: string | undefined;
  try {
    await work();
  } catch (error) {
    message = errorMessage(error);
  }

  revalidatePath("/", "layout");
  redirect(
    message
      ? `${destination}?error=${encodeURIComponent(message)}`
      : `${destination}?success=1`
  );
}

export async function register(form: FormData): Promise<never> {
  return perform("/login", async () => {
    const email = z
      .string()
      .email()
      .max(254)
      .parse(text(form, "email").toLowerCase());
    const name = required(form, "name", 80);
    const rawPassword = password(form);

    if (
      rawPassword.length < 12 ||
      Buffer.byteLength(rawPassword, "utf8") > 72
    ) {
      throw new Error("비밀번호는 12자 이상, UTF-8 기준 72바이트 이하여야 합니다.");
    }

    if (form.get("privacy") !== "on") {
      throw new Error("개인정보 처리 안내 확인이 필요합니다.");
    }

    await rateLimit("signup-global", "all", 30, 300);
    await rateLimit("signup-email", email, 3, 300);

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error("가입할 수 없는 이메일입니다. 기존 계정으로 로그인해 주세요.");
    }

    await db.user.create({
      data: {
        email,
        name,
        passwordHash: await hash(rawPassword, 12),
        role: "STUDENT"
      }
    });
  });
}

export async function createCohort(form: FormData): Promise<never> {
  const actor = await requireAdmin();

  return perform("/admin", async () => {
    const courseName = required(form, "courseName", 120);
    const field = required(form, "field", 120);
    const description = required(form, "description", 4000);
    const goal = required(form, "goal", 4000);
    const name = required(form, "name", 120);
    const instructions = required(form, "instructions", 10000);

    const { criteria, stages } = validateConfig(
      JSON.parse(required(form, "criteria", 60000)),
      JSON.parse(required(form, "stages", 10000))
    );

    const limits = validateLimits({
      target: Number(text(form, "target")),
      min: Number(text(form, "min")),
      max: Number(text(form, "max"))
    });

    const joinUntil = new Date(required(form, "joinUntil", 40));
    const deadline = new Date(required(form, "deadline", 40));

    if (
      !Number.isFinite(joinUntil.getTime()) ||
      !Number.isFinite(deadline.getTime()) ||
      joinUntil <= new Date() ||
      deadline < joinUntil
    ) {
      throw new Error("모집 종료는 현재 이후, 제출 마감은 모집 종료 이후여야 합니다.");
    }

    await db.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          name: courseName,
          field,
          description,
          goal,
          ownerId: actor.id
        }
      });

      const cohort = await tx.cohort.create({
        data: {
          courseId: course.id,
          name,
          instructions,
          joinCode: randomBytes(9).toString("hex").toUpperCase(),
          joinUntil,
          deadline,
          criteria: toJson(criteria),
          stages: toJson(stages),
          targetSize: limits.target,
          minSize: limits.min,
          maxSize: limits.max
        }
      });

      await audit(tx, cohort.id, actor.id, "COHORT_CREATED", {
        criteriaVersion: 1,
        limits
      });
    });
  });
}

export async function joinCohort(form: FormData): Promise<never> {
  const actor = await requireUser();

  return perform("/", async () => {
    if (actor.role !== "STUDENT") {
      throw new Error("수강생 계정으로 참여해 주세요.");
    }

    await rateLimit("join", actor.id, 10, 300);

    const joinCode = required(form, "code", 40).toUpperCase();
    const found = await db.cohort.findUnique({
      where: { joinCode },
      select: { id: true }
    });

    if (!found) throw new Error("유효하지 않거나 참여할 수 없는 코드입니다.");

    await withCohort(
      found.id,
      actor,
      async (tx, cohort) => {
        if (
          !cohort.codeActive ||
          cohort.state !== "OPEN" ||
          cohort.joinUntil < new Date()
        ) {
          throw new Error("유효하지 않거나 참여할 수 없는 코드입니다.");
        }

        if (cohort.enrollments.some((row) => row.userId === actor.id)) {
          throw new Error("이미 참여한 기수입니다.");
        }

        await tx.enrollment.create({
          data: {
            cohortId: cohort.id,
            userId: actor.id,
            criteriaVersion: cohort.criteriaVersion
          }
        });

        await audit(tx, cohort.id, actor.id, "ENROLLED", {});
      },
      { joining: true }
    );
  });
}

export async function saveSubmission(form: FormData): Promise<never> {
  const actor = await requireUser();
  const cohortId = required(form, "cohortId", 100);

  return perform(`/cohorts/${cohortId}`, async () => {
    if (actor.role !== "STUDENT") throw new Error("수강생만 제출할 수 있습니다.");

    const answer = z.string().max(30000).parse(text(form, "answer"));
    const intent = z.enum(["draft", "submit"]).parse(text(form, "intent"));

    if (intent === "submit" && !answer) {
      throw new Error("최종 제출할 답안을 입력해 주세요.");
    }

    const survey = surveySchema.parse(
      Array.from({ length: 4 }, (_, index) =>
        Number(text(form, `survey-${index}`))
      )
    );

    await withCohort(cohortId, actor, async (tx, cohort) => {
      if (cohort.state !== "OPEN" || cohort.deadline < new Date()) {
        throw new Error("현재 제출 가능한 기간이 아닙니다.");
      }

      const enrollment = cohort.enrollments.find(
        (row) => row.userId === actor.id
      )!;

      if (enrollment.submissionState === "SUBMITTED") {
        throw new Error("최종 제출 후에는 수정할 수 없습니다.");
      }

      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          answer,
          survey: toJson(survey),
          surveyVersion: SURVEY_VERSION,
          submissionState: intent === "submit" ? "SUBMITTED" : "DRAFT",
          submittedAt: intent === "submit" ? new Date() : null
        }
      });

      await audit(
        tx,
        cohort.id,
        actor.id,
        intent === "submit" ? "ANSWER_SUBMITTED" : "DRAFT_SAVED",
        { enrollmentId: enrollment.id, surveyVersion: SURVEY_VERSION }
      );
    });
  });
}

export async function operateCohort(form: FormData): Promise<never> {
  const actor = await requireAdmin();
  const cohortId = required(form, "cohortId", 100);

  return perform(`/admin/cohorts/${cohortId}`, async () => {
    const operation = z
      .enum(["disable-code", "start-grading", "close"])
      .parse(text(form, "operation"));
    const reason = required(form, "reason", 2000);
    await reauthenticate(actor, password(form));

    await withCohort(
      cohortId,
      actor,
      async (tx, cohort) => {
        if (operation === "disable-code") {
          await tx.cohort.update({
            where: { id: cohortId },
            data: { codeActive: false }
          });
        } else if (operation === "start-grading") {
          if (cohort.state !== "OPEN") {
            throw new Error("모집·진단 운영 중인 기수만 채점을 시작할 수 있습니다.");
          }
          await tx.cohort.update({
            where: { id: cohortId },
            data: { state: "GRADING", codeActive: false }
          });
        } else {
          if (cohort.state !== "PUBLISHED") {
            throw new Error("배정이 공개된 기수만 종료할 수 있습니다.");
          }
          await tx.cohort.update({
            where: { id: cohortId },
            data: { state: "CLOSED", codeActive: false }
          });
        }

        await audit(tx, cohortId, actor.id, "COHORT_OPERATION", {
          operation,
          reason,
          previousState: cohort.state
        });
      },
      { admin: true }
    );
  });
}

export async function grade(form: FormData): Promise<never> {
  const actor = await requireAdmin();
  const cohortId = required(form, "cohortId", 100);

  return perform(`/admin/cohorts/${cohortId}`, async () => {
    const enrollmentId = required(form, "enrollmentId", 100);
    const reason = required(form, "reason", 2000);
    const feedback = z.string().max(10000).parse(text(form, "feedback"));
    const expectedVersion = Number(text(form, "expectedVersion"));

    await withCohort(
      cohortId,
      actor,
      async (tx, cohort) => {
        if (!["GRADING", "REVIEW"].includes(cohort.state)) {
          throw new Error("채점 또는 배정 검토 단계에서만 점수를 변경할 수 있습니다.");
        }

        const enrollment = cohort.enrollments.find(
          (row) => row.id === enrollmentId
        );

        if (!enrollment || enrollment.submissionState !== "SUBMITTED") {
          throw new Error("해당 기수의 제출 완료 답안만 채점할 수 있습니다.");
        }

        if (enrollment.resultVersion !== expectedVersion) {
          throw new Error("다른 변경이 반영되었습니다. 화면을 새로고침해 주세요.");
        }

        const { criteria } = validateConfig(cohort.criteria, cohort.stages);
        const raw: Record<string, number> = {};

        for (const item of criteria) {
          const value = text(form, `score-${item.id}`);
          if (value !== "") raw[item.id] = Number(value);
        }

        const scores = validateScores(criteria, raw);

        await tx.enrollment.update({
          where: { id: enrollmentId },
          data: {
            scores: toJson(scores),
            feedback,
            gradedAt: new Date(),
            graderId: actor.id,
            resultVersion: { increment: 1 }
          }
        });

        await audit(tx, cohortId, actor.id, "SCORES_UPDATED", {
          enrollmentId,
          reason,
          previousVersion: enrollment.resultVersion,
          previousScores: enrollment.scores,
          scores,
          previousFeedback: enrollment.feedback,
          feedback
        });
      },
      { admin: true }
    );
  });
}

export async function generateAssignment(form: FormData): Promise<never> {
  const actor = await requireAdmin();
  const cohortId = required(form, "cohortId", 100);

  return perform(`/admin/cohorts/${cohortId}`, async () => {
    const reason = required(form, "reason", 2000);

    await withCohort(
      cohortId,
      actor,
      async (tx, cohort) => {
        if (!["GRADING", "REVIEW", "PUBLISHED"].includes(cohort.state)) {
          throw new Error("채점 시작 이후에만 배정안을 생성할 수 있습니다.");
        }

        const { criteria } = validateConfig(cohort.criteria, cohort.stages);
        const { snapshot, held } = assignmentInput(cohort);
        const groups = createGroups(snapshot.inputs, criteria, snapshot.limits);

        const assignment = await tx.assignment.create({
          data: {
            cohortId,
            algorithmVersion: ALGORITHM_VERSION,
            snapshot: toJson(snapshot),
            groups: toJson(groups),
            held: toJson(held),
            reason,
            createdBy: actor.id
          }
        });

        if (cohort.state !== "PUBLISHED") {
          await tx.cohort.update({
            where: { id: cohortId },
            data: { state: "REVIEW" }
          });
        }

        await audit(tx, cohortId, actor.id, "ASSIGNMENT_GENERATED", {
          assignmentId: assignment.id,
          algorithmVersion: ALGORITHM_VERSION,
          reason,
          held
        });
      },
      { admin: true }
    );
  });
}

export async function moveMember(form: FormData): Promise<never> {
  const actor = await requireAdmin();
  const cohortId = required(form, "cohortId", 100);

  return perform(`/admin/cohorts/${cohortId}`, async () => {
    const assignmentId = required(form, "assignmentId", 100);
    const enrollmentId = required(form, "enrollmentId", 100);
    const targetGroupId = required(form, "targetGroupId", 100);
    const reason = required(form, "reason", 2000);

    await withCohort(
      cohortId,
      actor,
      async (tx, cohort) => {
        if (cohort.state === "CLOSED") throw new Error("종료된 기수입니다.");

        const assignment = await tx.assignment.findFirst({
          where: { id: assignmentId, cohortId, state: "REVIEW" }
        });
        if (!assignment) throw new Error("검토 중인 배정안만 조정할 수 있습니다.");

        const previous = assignment.groups as unknown as Group[];
        const groups = previous.map((group) => ({
          ...group,
          members: [...group.members]
        }));
        const source = groups.find((group) =>
          group.members.includes(enrollmentId)
        );
        const target = groups.find((group) => group.id === targetGroupId);

        if (!source || !target || source.id === target.id) {
          throw new Error("이동할 구성원과 다른 대상 그룹을 선택해 주세요.");
        }

        source.members = source.members.filter((id) => id !== enrollmentId);
        target.members.push(enrollmentId);

        await tx.assignment.update({
          where: { id: assignmentId },
          data: { groups: toJson(groups) }
        });

        await audit(tx, cohortId, actor.id, "MEMBER_MOVED", {
          assignmentId,
          enrollmentId,
          reason,
          before: previous,
          after: groups
        });
      },
      { admin: true }
    );
  });
}

export async function publishAssignment(form: FormData): Promise<never> {
  const actor = await requireAdmin();
  const cohortId = required(form, "cohortId", 100);

  return perform(`/admin/cohorts/${cohortId}`, async () => {
    const assignmentId = required(form, "assignmentId", 100);
    const reason = required(form, "reason", 2000);
    await reauthenticate(actor, password(form));

    await withCohort(
      cohortId,
      actor,
      async (tx, cohort) => {
        if (!["REVIEW", "PUBLISHED"].includes(cohort.state)) {
          throw new Error("배정 검토 또는 공개 단계에서만 확정할 수 있습니다.");
        }

        const assignment = await tx.assignment.findFirst({
          where: { id: assignmentId, cohortId, state: "REVIEW" }
        });
        if (!assignment) throw new Error("검토 중인 배정안을 찾을 수 없습니다.");

        const snapshot = assignment.snapshot as unknown as Snapshot;
        const current = assignmentInput(cohort);

        if (JSON.stringify(snapshot) !== JSON.stringify(current.snapshot)) {
          throw new Error("배정 생성 이후 입력 결과가 변경되었습니다. 새 배정안을 생성하세요.");
        }

        if (current.held.length && form.get("acknowledgeHeld") !== "on") {
          throw new Error("보류 대상자를 확인해야 공개할 수 있습니다.");
        }

        validateGroups(
          assignment.groups as unknown as Group[],
          snapshot.inputs.map((item) => item.id),
          snapshot.limits
        );

        await tx.assignment.update({
          where: { id: assignmentId },
          data: {
            state: "CONFIRMED",
            confirmedBy: actor.id,
            confirmedAt: new Date()
          }
        });

        await tx.cohort.update({
          where: { id: cohortId },
          data: {
            publishedAssignmentId: assignmentId,
            resultsPublished: true,
            state: "PUBLISHED",
            codeActive: false
          }
        });

        await audit(tx, cohortId, actor.id, "ASSIGNMENT_PUBLISHED", {
          assignmentId,
          previousPublishedAssignmentId: cohort.publishedAssignmentId,
          reason,
          heldAcknowledged: current.held.length > 0
        });
      },
      { admin: true }
    );
  });
}
