import { z } from 'zod';
import { Actor, Id } from '../../shared/contracts.js';
import { AnalysisWorkflow } from './analysis-workflow.js';
import { WelfareNeed } from './welfare-contracts.js';
import { WelfareRecommendationService } from './welfare-service.js';

// A staff attestation, not a classifier: no need is extracted from generated prose.
export const ConfirmedAnalysisNeeds = z.object({
  analysis_id: Id,
  expected_analysis_version: z.number().int().positive(),
  confirmations: z.array(z.object({
    need: WelfareNeed,
    finding_index: z.number().int().nonnegative(),
    evidence_index: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  }).strict()).min(1).max(3).refine(items => new Set(items.map(item => item.need)).size === items.length),
}).strict();

export class AnalysisWelfareError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'ANALYSIS_VERSION_CONFLICT' | 'NEED_EVIDENCE_MISSING', public readonly status: number) { super(code); }
}

export class AnalysisWelfareBridge {
  constructor(private workflow: AnalysisWorkflow, private welfare: WelfareRecommendationService) {}

  async recommend(rawActor: unknown, raw: unknown) {
    const actor = Actor.parse(rawActor);
    if (actor.role !== 'staff') throw new AnalysisWelfareError('FORBIDDEN', 403);
    const request = ConfirmedAnalysisNeeds.parse(raw);
    // Reuse workflow ownership, BE1 authorization, approval and BE2 source checks.
    // Never accept a caller-supplied published-result object.
    const approved = await this.workflow.published(actor, request.analysis_id);
    if (approved.version !== request.expected_analysis_version) throw new AnalysisWelfareError('ANALYSIS_VERSION_CONFLICT', 409);
    const confirmations = request.confirmations.map(confirmation => {
      const evidence = approved.draft?.findings[confirmation.finding_index]?.evidence[confirmation.evidence_index];
      if (!evidence) throw new AnalysisWelfareError('NEED_EVIDENCE_MISSING', 422);
      return { ...confirmation, evidence: structuredClone(evidence) };
    });
    const input = {
      person_id: approved.input.person_id,
      needs: confirmations.map(confirmation => confirmation.need),
      region: null, age_group: null, income_status: 'unknown' as const,
    };
    const data = await this.welfare.recommend(actor, input);
    // Fail closed if records/permissions changed while the catalog was loading.
    await this.workflow.published(actor, request.analysis_id);
    return {
      data,
      connection: {
        analysis_id: approved.id, analysis_version: approved.version,
        review_state: approved.review_state, provider_kind: approved.provider_kind,
        confirmed_by: actor.user_id, confirmed_at: new Date().toISOString(),
        needs_origin: 'explicit_staff_confirmation' as const,
        confirmations, recommendation_input: input,
      },
    };
  }
}
