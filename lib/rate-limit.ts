import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export async function rateLimit(
  scope: string,
  identifier: string,
  maximum: number,
  windowSeconds = 60
): Promise<void> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const digest = createHash("sha256")
    .update(identifier)
    .digest("hex");
  const key = `${scope}:${digest}:${bucket}`;

  const record = await db.rateLimit.upsert({
    where: { key },
    create: {
      key,
      count: 1,
      expiresAt: new Date((bucket + 1) * windowSeconds * 1000)
    },
    update: { count: { increment: 1 } }
  });

  if (record.count > maximum) {
    throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }
}
