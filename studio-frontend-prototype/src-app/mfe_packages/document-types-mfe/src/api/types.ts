/**
 * The `studio-documents` shapes the Document types screen reads and writes,
 * as the prototype's client declared them (00828880:studio-frontend-prototype/src/api.ts).
 */

export interface DocSection {
  key: string;
  title: string;
  required: boolean;
  min_words?: number | null;
  description?: string | null;
  aliases?: string[] | null;
}

export interface DocRules {
  warn_unknown_sections: boolean;
  front_matter: string[];
  forbid_placeholders: boolean;
  min_title_words: number;
}

export interface DocType {
  key: string;
  name: string;
  description: string;
  gts_type_id: string;
  owner: 'builtin' | 'organization' | 'workspace';
  owner_tenant_id?: string | null;
  body: string;
  sections: DocSection[];
  rules: DocRules;
}

export interface DocTypeList {
  items: DocType[];
}

/** `POST /studio-documents/v1/workspaces/{id}/types`: always a workspace-owned type. */
export interface UpsertDocTypeBody {
  key: string;
  name: string;
  description?: string;
  body: string;
  sections: DocSection[];
  rules?: DocRules;
}

/** `GET /studio-spec-quality/v1/capabilities`: what the analyser declares it accepts. */
export interface SpecQualityCapabilities {
  detectors?: string[];
  doc_types?: string[];
}
