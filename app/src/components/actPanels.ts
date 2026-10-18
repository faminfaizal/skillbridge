// Props shared by the "Act" side panels (incident response, community exchange): how a panel talks to Home.
export interface GraphHighlight { nodeIds: string[]; stars?: string[]; danger?: string[]; pulse?: string[] }

export interface ActPanelProps {
  onFocus: (id: string) => void;           // open a person or node in the side panel
  onShow: (v: GraphHighlight) => void;      // light up nodes on the graph
  onAgents: () => void;                     // open the Agents panel (inbox)
  onToast: (message: string) => void;       // short status message
  refreshAgents: () => void;                // reload the agents badge after a proposal or approval
}
