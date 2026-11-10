import { z } from "zod";

/** Marking of written answers: vocabulary shared by the API (which enforces it) and the web app. */

export const MAX_MARK_COMMENT = 1000;

/**
 * A person's mark for one essay answer, given per rubric point (in the rubric's order).
 * `basedOn` is the total the marker was looking at (null = not yet marked). If someone else changed it in the meantime the
 * request is refused, so two markers can never silently overwrite each other. Changing an existing mark needs a reason.
 */
export const markEssaySchema = z.object({
  criteria: z.array(z.number().finite().min(0)).min(1).max(25),
  comment: z.string().trim().max(MAX_MARK_COMMENT).nullable().default(null),
  basedOn: z.number().nullable(),
  reason: z.string().trim().min(5, "Say briefly why you are changing this mark").max(300).optional(),
  /** The AI suggestion the marker started from, if any. The mark is still entirely theirs. */
  proposalId: z.string().uuid().optional(),
});
export type MarkEssayInput = z.infer<typeof markEssaySchema>;

export const MARK_CONFIDENCE = ["low", "medium", "high"] as const;
export type MarkConfidence = (typeof MARK_CONFIDENCE)[number];
