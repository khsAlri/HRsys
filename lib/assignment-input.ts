import type { LockedCohort } from "@/lib/access";
import {
  SURVEY_VERSION,
  holdingReasons,
  validateConfig,
  type Candidate,
  type Scores,
  type Snapshot
} from "@/lib/domain";

export function assignmentInput(cohort: LockedCohort): {
  snapshot: Snapshot;
  held: { id: string; reasons: string[] }[];
} {
  const { criteria } = validateConfig(cohort.criteria, cohort.stages);
  const inputs: Candidate[] = [];
  const held: { id: string; reasons: string[] }[] = [];

  for (const row of [...cohort.enrollments].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    const reasons = holdingReasons(criteria, row, cohort.criteriaVersion);
    if (reasons.length) {
      held.push({ id: row.id, reasons });
    } else {
      inputs.push({
        id: row.id,
        scores: row.scores as unknown as Scores,
        survey: row.survey as unknown as number[],
        resultVersion: row.resultVersion
      });
    }
  }

  return {
    snapshot: {
      criteriaVersion: cohort.criteriaVersion,
      surveyVersion: SURVEY_VERSION,
      limits: {
        target: cohort.targetSize,
        min: cohort.minSize,
        max: cohort.maxSize
      },
      inputs
    },
    held
  };
}
