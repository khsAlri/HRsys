import { compare } from "bcryptjs";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Prisma, type User } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export type Actor = Pick<User, "id" | "name" | "email" | "role">;

export type LockedCohort = Prisma.CohortGetPayload<{
  include: {
    course: true;
    enrollments: true;
  };
}>;

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function requireUser(): Promise<Actor> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true }
  });

  if (!user) redirect("/login");

  if (
    user.role === "ADMIN" &&
    Date.now() - session.authenticatedAt > 15 * 60 * 1000
  ) {
    redirect("/login?expired=1");
  }

  return user;
}

export async function requireAdmin(): Promise<Actor> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

export async function reauthenticate(
  actor: Actor,
  password: string
): Promise<void> {
  await rateLimit("reauth", actor.id, 5, 300);
  if (!password || password.length > 128) {
    throw new Error("현재 비밀번호를 입력해 주세요.");
  }

  const user = await db.user.findUnique({ where: { id: actor.id } });
  if (!user || !(await compare(password, user.passwordHash))) {
    throw new Error("재인증에 실패했습니다.");
  }
}

export async function withCohort<T>(
  cohortId: string,
  actor: Actor,
  work: (
    tx: Prisma.TransactionClient,
    cohort: LockedCohort
  ) => Promise<T>,
  options: { admin?: boolean; joining?: boolean } = {}
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "Cohort"
      WHERE "id" = ${cohortId}
      FOR UPDATE
    `;

    const cohort = await tx.cohort.findUnique({
      where: { id: cohortId },
      include: { course: true, enrollments: true }
    });

    if (!cohort) throw new Error("기수를 찾을 수 없습니다.");

    if (actor.role === "ADMIN") {
      if (cohort.course.ownerId !== actor.id) {
        throw new Error("담당 기수에만 접근할 수 있습니다.");
      }
    } else {
      if (options.admin) throw new Error("관리자 권한이 필요합니다.");
      if (
        !options.joining &&
        !cohort.enrollments.some((row) => row.userId === actor.id)
      ) {
        throw new Error("참여한 기수에만 접근할 수 있습니다.");
      }
    }

    return work(tx, cohort);
  });
}

export async function audit(
  tx: Prisma.TransactionClient,
  cohortId: string,
  actorId: string,
  action: string,
  detail: unknown
): Promise<void> {
  await tx.audit.create({
    data: {
      cohortId,
      actorId,
      action,
      detail: toJson(detail)
    }
  });
}
