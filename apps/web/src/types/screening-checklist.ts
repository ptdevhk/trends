export interface ScreeningChecklistItem {
  verdict: string
  evidence?: string
}

export interface ScreeningChecklist {
  generatedBy?: 'rules' | 'ai' | 'rules+ai' | string
  sellsMachines?: ScreeningChecklistItem // yes|no|unclear
  machineOrigin?: ScreeningChecklistItem // international|domestic|unknown
  channel?: ScreeningChecklistItem // direct|distributor|unclear
  region?: ScreeningChecklistItem // verdict = region text, may be ""
  contactStatus?: ScreeningChecklistItem // valid|problem|unclear
}
