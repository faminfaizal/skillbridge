// Demo reset for the newer features: simulated crises, posted community requests, volunteer logs and social records.
import { resetCrisis } from "../engine/crisis.ts";
import { resetCommunity } from "../engine/community.ts";
import { resetSocial } from "../engine/socialStore.ts";

export function resetExtensions(): number {
  return resetCrisis() + resetCommunity() + resetSocial();
}
