import type { UploadKind, UploadSectionSummary } from "@tmp/shared";

export interface ParsedItem {
  row: number; sourceRow: number; sheet: string | null; type: string; stem: string; options: string[]; correctIndex: number | null; correctBool: boolean | null;
  accepted: string[]; explanation: string | null; marks: number | null; difficulty: string | null; timeSec: number | null; problems: string[]; notes: string[]; duplicate?: boolean;
}
export interface UploadSummary {
  id: string; filename: string; kind: UploadKind; sizeBytes: number; charCount: number; warnings: string[]; createdAt: string; sections: UploadSectionSummary[];
  questionTable: { layout: string; total: number; ready: number; suggestedTimeSec: number | null; truncated: boolean; items?: ParsedItem[] } | null;
}
