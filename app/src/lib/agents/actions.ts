// Approval handlers for the newer proposal kinds. inbox.ts decide() dispatches here by action.type.
import { approveMobilise } from "../engine/crisis.ts";
import { approveVolunteer } from "../engine/community.ts";
import { approveRedeploy } from "../engine/redeploy.ts";

export type ActionHandler = (a: Record<string, any>, inboxId: number) => { outcome: string; changed: boolean };

export const ACTION_HANDLERS: Record<string, ActionHandler> = {
  mobilise: approveMobilise,
  volunteer: approveVolunteer,
  redeploy: approveRedeploy,
};
