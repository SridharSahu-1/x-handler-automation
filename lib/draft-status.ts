/** Missed approval windows do not prevent you from publishing a draft later. */
export function canReviewDraft(status: string) {
  return ["pending", "approved", "expired"].includes(status);
}
