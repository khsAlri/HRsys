import { z } from "zod";

const finiteNumber = z.number().finite();

export const criteriaSchema = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
      name: z.string().trim().min(1).max(100),
      purpose: z.string().trim().min(1).max(1000),
      max: finiteNumber.positive().max(100000),
      weight: finiteNumber.min(0).max(100),
      rubric: z.string().trim().min(1).max(4000),
      required: z.boolean(),
      grouping: z.boolean()
    })
  )
  .min(1)
  .max(30);

export const stagesSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(100),
      min: finiteNumber.min(0).max(100),
      max: finiteNumber.min(0).max(100)
    })
  )
  .min(1)
  .max(20);

export const surveySchema = z
  .array(z.number().int().min(1).max(5))
  .length(4);

export type Criterion = z.infer<typeof criteriaSchema>[number];
export type Stage = z.infer<typeof stagesSchema>[number];
export type Scores = Record<string, number>;
export type Limits = { target: number; min: number; max: number };

export type Candidate = {
  id: string;
  scores: Scores;
  survey: number[];
  resultVersion: number;
};

export type Group = {
  id: string;
  name: string;
  members: string[];
};

export type Snapshot = {
  criteriaVersion: number;
  surveyVersion: number;
  limits: Limits;
  inputs: Candidate[];
};

export const ALGORITHM_VERSION = "capacity-nearest-profile/1";
export const SURVEY_VERSION = 1;

export const defaultCriteria: Criterion[] = [
  {
    id: "concept",
    name: "개념 이해",
    purpose: "과정의 핵심 개념 이해도",
    max: 100,
    weight: 50,
    rubric: "핵심 개념의 정확성, 설명의 논리성, 사례 적용을 확인한다.",
    required: true,
    grouping: true
  },
  {
    id: "practice",
    name: "실무 적용",
    purpose: "배운 내용을 과제에 적용하는 능력",
    max: 100,
    weight: 50,
    rubric: "문제 해결 과정과 결과의 적절성 및 근거를 확인한다.",
    required: true,
    grouping: true
  }
];

export const defaultStages: Stage[] = [
  { name: "기초 다지기", min: 0, max: 40 },
  { name: "적용 연습", min: 40, max: 70 },
  { name: "심화 학습", min: 70, max: 100 }
];

export const surveyLabels = [
  ["개념 설명 중심", "실습 중심"],
  ["개인 학습 중심", "협업 중심"],
  ["단계별 안내 선호", "자율 탐색 선호"],
  ["반복 학습 선호", "빠른 진도 선호"]
];

export function validateConfig(
  rawCriteria: unknown,
  rawStages: unknown
): { criteria: Criterion[]; stages: Stage[] } {
  const criteria = criteriaSchema.parse(rawCriteria);
  const stages = stagesSchema.parse(rawStages).sort((a, b) => a.min - b.min);

  if (new Set(criteria.map((item) => item.id)).size !== criteria.length) {
    throw new Error("평가 항목 ID가 중복되었습니다.");
  }

  const weight = criteria.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(weight - 100) > 0.000001) {
    throw new Error("평가 항목 가중치 합계는 100이어야 합니다.");
  }

  if (!criteria.some((item) => item.grouping && item.weight > 0)) {
    throw new Error("양수 가중치를 가진 배정 반영 항목이 필요합니다.");
  }

  if (stages[0].min !== 0 || stages[stages.length - 1].max !== 100) {
    throw new Error("학습 단계는 0점부터 100점까지 포함해야 합니다.");
  }

  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    if (stage.min >= stage.max) {
      throw new Error("학습 단계의 하한은 상한보다 작아야 합니다.");
    }
    if (index > 0 && stages[index - 1].max !== stage.min) {
      throw new Error("학습 단계 구간에 중복 또는 누락이 있습니다.");
    }
  }

  return { criteria, stages };
}

export function validateLimits(limits: Limits): Limits {
  if (
    ![limits.target, limits.min, limits.max].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 100
    ) ||
    limits.min > limits.target ||
    limits.target > limits.max
  ) {
    throw new Error("그룹 인원은 1 이상이며 최소 ≤ 목표 ≤ 최대여야 합니다.");
  }
  return limits;
}

export function validateScores(
  criteria: Criterion[],
  raw: unknown
): Scores {
  const scores = z.record(finiteNumber).parse(raw);
  const allowed = new Set(criteria.map((item) => item.id));

  for (const key of Object.keys(scores)) {
    if (!allowed.has(key)) {
      throw new Error("존재하지 않는 평가 항목이 있습니다.");
    }
  }

  for (const item of criteria) {
    const score = scores[item.id];
    if (score === undefined) {
      if (item.required) {
        throw new Error(`필수 항목 '${item.name}'의 채점이 필요합니다.`);
      }
      continue;
    }
    if (score < 0 || score > item.max) {
      throw new Error(`'${item.name}' 점수는 0~${item.max} 범위여야 합니다.`);
    }
  }

  return scores;
}

export function totalScore(
  criteria: Criterion[],
  scores: Scores
): number | null {
  if (criteria.some((item) => item.weight > 0 && scores[item.id] === undefined)) {
    return null;
  }

  return criteria.reduce(
    (sum, item) =>
      sum + ((scores[item.id] ?? 0) / item.max) * item.weight,
    0
  );
}

export function stageName(stages: Stage[], score: number | null): string {
  if (score === null) {
    return "종합 점수 산출 보류";
  }
  const stage = stages.find(
    (item, index) =>
      score >= item.min &&
      (score < item.max ||
        (index === stages.length - 1 && score <= item.max))
  );
  return stage?.name ?? "단계 확인 필요";
}

export function holdingReasons(
  criteria: Criterion[],
  row: {
    submissionState: string;
    gradedAt: Date | null;
    scores: unknown;
    survey: unknown;
    surveyVersion: number | null;
    criteriaVersion: number;
  },
  version: number
): string[] {
  const reasons: string[] = [];

  if (row.submissionState !== "SUBMITTED") reasons.push("미제출");
  if (!row.gradedAt) reasons.push("미채점");

  if (row.criteriaVersion !== version) {
    reasons.push("평가 기준 버전 불일치");
  }

  if (
    !surveySchema.safeParse(row.survey).success ||
    row.surveyVersion !== SURVEY_VERSION
  ) {
    reasons.push("학습 성향 설문 미완료 또는 버전 불일치");
  }

  try {
    const scores = validateScores(criteria, row.scores);
    if (
      criteria.some(
        (item) =>
          item.grouping &&
          item.weight > 0 &&
          scores[item.id] === undefined
      )
    ) {
      reasons.push("배정 반영 항목 미채점");
    }
  } catch {
    reasons.push("필수 채점 누락 또는 점수 오류");
  }

  return [...new Set(reasons)];
}

export function capacities(count: number, limits: Limits): number[] {
  validateLimits(limits);

  const minimumGroups = Math.ceil(count / limits.max);
  const maximumGroups = Math.floor(count / limits.min);

  if (count === 0 || minimumGroups > maximumGroups) {
    throw new Error("현재 대상자 수로 인원 조건을 만족할 수 없습니다.");
  }

  const choices = Array.from(
    { length: maximumGroups - minimumGroups + 1 },
    (_, index) => minimumGroups + index
  ).sort(
    (a, b) =>
      Math.abs(count / a - limits.target) -
        Math.abs(count / b - limits.target) ||
      a - b
  );

  const groupCount = choices[0];
  const base = Math.floor(count / groupCount);
  const extra = count % groupCount;

  return Array.from(
    { length: groupCount },
    (_, index) => base + (index < extra ? 1 : 0)
  );
}

function distances(
  candidate: Candidate,
  members: Candidate[],
  criteria: Criterion[]
): [number, number] {
  const items = criteria.filter((item) => item.grouping && item.weight > 0);
  const weight = items.reduce((sum, item) => sum + item.weight, 0);

  let skill = 0;
  for (const item of items) {
    const centroid =
      members.reduce(
        (sum, member) => sum + (member.scores[item.id] / item.max) * 100,
        0
      ) / members.length;
    const value = (candidate.scores[item.id] / item.max) * 100;
    skill += ((value - centroid) ** 2 * item.weight) / weight;
  }

  let preference = 0;
  for (let axis = 0; axis < 4; axis += 1) {
    const centroid =
      members.reduce((sum, member) => sum + member.survey[axis], 0) /
      members.length;
    preference += (candidate.survey[axis] - centroid) ** 2;
  }

  return [Math.round(skill * 1e6) / 1e6, preference];
}

export function createGroups(
  candidates: Candidate[],
  criteria: Criterion[],
  limits: Limits
): Group[] {
  if (new Set(candidates.map((item) => item.id)).size !== candidates.length) {
    throw new Error("배정 대상자가 중복되었습니다.");
  }

  if (!criteria.some((item) => item.grouping && item.weight > 0)) {
    throw new Error("유효한 배정 반영 항목이 없습니다.");
  }

  for (const candidate of candidates) {
    validateScores(criteria, candidate.scores);
    surveySchema.parse(candidate.survey);
    if (
      criteria.some(
        (item) =>
          item.grouping &&
          item.weight > 0 &&
          candidate.scores[item.id] === undefined
      )
    ) {
      throw new Error("배정 반영 항목 점수가 누락되었습니다.");
    }
  }

  const sizes = capacities(candidates.length, limits);
  const pool = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const groups: Group[] = [];

  for (const size of sizes) {
    const members = [pool.shift()!];

    while (members.length < size) {
      pool.sort((a, b) => {
        const left = distances(a, members, criteria);
        const right = distances(b, members, criteria);
        return (
          left[0] - right[0] ||
          left[1] - right[1] ||
          a.id.localeCompare(b.id)
        );
      });
      members.push(pool.shift()!);
    }

    const number = groups.length + 1;
    groups.push({
      id: `group-${number}`,
      name: `${number}그룹`,
      members: members.map((member) => member.id)
    });
  }

  validateGroups(groups, candidates.map((item) => item.id), limits);
  return groups;
}

export function validateGroups(
  groups: Group[],
  expectedIds: string[],
  limits: Limits
): void {
  validateLimits(limits);

  if (!groups.length || new Set(groups.map((group) => group.id)).size !== groups.length) {
    throw new Error("그룹이 없거나 그룹 ID가 중복되었습니다.");
  }

  const members = groups.flatMap((group) => group.members);
  const expected = new Set(expectedIds);

  if (
    expected.size !== expectedIds.length ||
    new Set(members).size !== members.length ||
    members.length !== expected.size ||
    members.some((id) => !expected.has(id))
  ) {
    throw new Error("배정 대상 누락, 중복 또는 잘못된 구성원이 있습니다.");
  }

  if (
    groups.some(
      (group) =>
        group.members.length < limits.min ||
        group.members.length > limits.max
    )
  ) {
    throw new Error("그룹별 최소·최대 인원 조건을 만족해야 합니다.");
  }
}
