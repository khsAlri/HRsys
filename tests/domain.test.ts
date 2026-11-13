import { describe, expect, it } from "vitest";
import {
  capacities,
  createGroups,
  defaultCriteria,
  defaultStages,
  holdingReasons,
  stageName,
  totalScore,
  validateConfig,
  validateGroups,
  validateScores,
  type Candidate
} from "../lib/domain";

function candidates(count: number): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `student-${String(index).padStart(3, "0")}`,
    scores: {
      concept: (index * 7) % 101,
      practice: (index * 11) % 101
    },
    survey: [1 + index % 5, 3, 3, 3],
    resultVersion: 1
  }));
}

describe("평가 기준", () => {
  it("가중치 합계가 100이 아니면 거부한다", () => {
    expect(() =>
      validateConfig(
        defaultCriteria.map((item) => ({ ...item, weight: 20 })),
        defaultStages
      )
    ).toThrow();
  });

  it("단계의 중복과 누락을 거부한다", () => {
    expect(() =>
      validateConfig(defaultCriteria, [
        { name: "기초", min: 0, max: 50 },
        { name: "심화", min: 60, max: 100 }
      ])
    ).toThrow();
  });

  it("0점과 필수 미채점을 구분한다", () => {
    expect(validateScores(defaultCriteria, { concept: 0, practice: 0 }))
      .toEqual({ concept: 0, practice: 0 });

    expect(() =>
      validateScores(defaultCriteria, { concept: 0 })
    ).toThrow();
  });

  it("음수와 만점 초과 점수를 거부한다", () => {
    expect(() =>
      validateScores(defaultCriteria, { concept: -1, practice: 50 })
    ).toThrow();
    expect(() =>
      validateScores(defaultCriteria, { concept: 101, practice: 50 })
    ).toThrow();
  });

  it("가중 평균과 학습 단계 경계를 계산한다", () => {
    const score = totalScore(defaultCriteria, { concept: 80, practice: 60 });
    expect(score).toBe(70);
    expect(stageName(defaultStages, score)).toBe("심화 학습");
    expect(stageName(defaultStages, 100)).toBe("심화 학습");
    expect(stageName(defaultStages, 40)).toBe("적용 연습");
  });

  it("선택 항목 미채점을 임의의 0점으로 처리하지 않는다", () => {
    const criteria = defaultCriteria.map((item) => ({
      ...item,
      required: false
    }));
    expect(totalScore(criteria, { concept: 70 })).toBeNull();
  });
});

describe("보류 처리", () => {
  it("미제출, 미채점, 설문 미완료를 각각 기록한다", () => {
    const reasons = holdingReasons(
      defaultCriteria,
      {
        submissionState: "DRAFT",
        gradedAt: null,
        scores: null,
        survey: null,
        surveyVersion: null,
        criteriaVersion: 1
      },
      1
    );

    expect(reasons).toContain("미제출");
    expect(reasons).toContain("미채점");
    expect(reasons).toContain("학습 성향 설문 미완료 또는 버전 불일치");
  });

  it("모든 필수 점수가 0점이어도 완료 결과로 인정한다", () => {
    expect(
      holdingReasons(
        defaultCriteria,
        {
          submissionState: "SUBMITTED",
          gradedAt: new Date(),
          scores: { concept: 0, practice: 0 },
          survey: [3, 3, 3, 3],
          surveyVersion: 1,
          criteriaVersion: 1
        },
        1
      )
    ).toEqual([]);
  });
});

describe("그룹 배정", () => {
  const limits = { target: 5, min: 3, max: 6 };

  it("30명을 목표 5명 기준으로 6개 그룹에 배정한다", () => {
    const groups = createGroups(candidates(30), defaultCriteria, limits);
    expect(groups).toHaveLength(6);
    expect(groups.every((group) => group.members.length === 5)).toBe(true);
    expect(new Set(groups.flatMap((group) => group.members)).size).toBe(30);
  });

  it("나누어떨어지지 않는 인원도 제약 안에서 배정한다", () => {
    const groups = createGroups(candidates(31), defaultCriteria, limits);
    expect(groups).toHaveLength(6);
    expect(groups.map((group) => group.members.length)).toEqual([6, 5, 5, 5, 5, 5]);
  });

  it("불가능한 조건과 0명 배정을 거부한다", () => {
    expect(() => capacities(2, limits)).toThrow();
    expect(() => capacities(0, limits)).toThrow();
    expect(() => capacities(11, { target: 5, min: 5, max: 5 })).toThrow();
  });

  it("같은 입력은 같은 배정 결과를 만든다", () => {
    const input = candidates(30);
    expect(createGroups(input, defaultCriteria, limits)).toEqual(
      createGroups([...input].reverse(), defaultCriteria, limits)
    );
  });

  it("총점이 같아도 항목별 역량 구성을 비교한다", () => {
    const input: Candidate[] = [
      {
        id: "a",
        scores: { concept: 100, practice: 0 },
        survey: [1, 1, 1, 1],
        resultVersion: 1
      },
      {
        id: "b",
        scores: { concept: 0, practice: 100 },
        survey: [1, 1, 1, 1],
        resultVersion: 1
      },
      {
        id: "c",
        scores: { concept: 100, practice: 0 },
        survey: [5, 5, 5, 5],
        resultVersion: 1
      },
      {
        id: "d",
        scores: { concept: 0, practice: 100 },
        survey: [5, 5, 5, 5],
        resultVersion: 1
      }
    ];

    const groups = createGroups(input, defaultCriteria, {
      target: 2,
      min: 2,
      max: 2
    });

    expect(groups[0].members).toEqual(["a", "c"]);
    expect(groups[1].members).toEqual(["b", "d"]);
  });

  it("역량 거리가 동일할 때 학습 선호를 보조 기준으로 사용한다", () => {
    const input = ["a", "b", "c", "d"].map((id, index) => ({
      id,
      scores: { concept: 50, practice: 50 },
      survey: index === 1 || index === 3 ? [5, 5, 5, 5] : [1, 1, 1, 1],
      resultVersion: 1
    }));

    expect(
      createGroups(input, defaultCriteria, { target: 2, min: 2, max: 2 })[0].members
    ).toEqual(["a", "c"]);
  });

  it("중복 배정을 확정 검증에서 차단한다", () => {
    expect(() =>
      validateGroups(
        [
          { id: "g1", name: "1", members: ["a", "b"] },
          { id: "g2", name: "2", members: ["b", "c"] }
        ],
        ["a", "b", "c", "d"],
        { target: 2, min: 2, max: 2 }
      )
    ).toThrow();
  });

  it("배정 반영 항목 미채점을 차단한다", () => {
    const input = candidates(6);
    delete input[0].scores.practice;
    expect(() => createGroups(input, defaultCriteria, limits)).toThrow();
  });
});
