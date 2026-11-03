import { weeklyDigestStep } from "./steps";

export async function weeklyDigest() {
  "use workflow";
  await weeklyDigestStep();
}
