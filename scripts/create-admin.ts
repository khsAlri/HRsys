import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (
    !email ||
    !name ||
    !password ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error(
      "ADMIN_EMAIL, ADMIN_NAME과 12자 이상·UTF-8 72바이트 이하의 ADMIN_PASSWORD를 설정하세요."
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    throw new Error(
      "이미 존재하는 이메일입니다. 이 스크립트는 기존 계정의 권한을 변경하지 않습니다."
    );
  }

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hash(password, 12),
      role: "ADMIN"
    }
  });

  console.log("관리자 계정 생성 완료. 관리자 비밀번호 환경 변수를 제거하세요.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "관리자 생성 실패");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
