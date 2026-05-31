// Typed API client for UbatLah backend
// All functions return typed results and throw on network/server errors.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export type NpraInfo = {
  product: string | null
  registration_no: string | null
  status: string | null
  description: string | null
  holder: string | null
  manufacturer: string | null
  active_ingredient: string | null
  generic_name: string | null
  match_score: number
  match_mode?: string
  match_reason?: string
  match_details?: string[]
  strength_matches?: string[]
  company_matches?: string[]
  verification_status?: 'VERIFIED' | 'PROBABLE' | 'UNVERIFIED'
}

export type DrugLabelInfo = Record<string, string>

export type OcrResult = {
  success: boolean
  raw_text: string
  cleaned_text: string
  provider?: string | null
}

export type NpraResult = {
  found: boolean
  message?: string
  normalized_query?: string
  npra_info?: NpraInfo
}

export type OpenFdaResult = {
  success: boolean
  active_ingredient_queried: string
  drug_label_info: DrugLabelInfo | null
  message?: string
}

export type PatientUploadResult = {
  success: boolean
  message: string
  chunks_indexed: number
  total_characters: number
}

export type AnalyzeResult = {
  success: boolean
  summary: string
  patient_context_retrieved: string
}

export type ChatResult = {
  success: boolean
  question: string
  answer: string
  patient_context_retrieved: string
}

export type PatientStatus = {
  collection: string
  chunks_stored: number
  patient_indexed: boolean
}

// ── helpers ────────────────────────────────────────────────────────────

async function post<T>(path: string, body: FormData | null, json = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: body ?? undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json() as Promise<T>
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json() as Promise<T>
}

// ── API functions ──────────────────────────────────────────────────────

export async function ocrImage(file: File): Promise<OcrResult> {
  const fd = new FormData()
  fd.append('file', file)
  return post<OcrResult>('/ocr', fd)
}

export async function verifyNpra(ocrText: string, rawOcrText?: string): Promise<NpraResult> {
  const fd = new FormData()
  fd.append('ocr_text', ocrText)
  if (rawOcrText) fd.append('raw_ocr_text', rawOcrText)
  return post<NpraResult>('/verify-npra', fd)
}

export async function getOpenFda(activeIngredient?: string): Promise<OpenFdaResult> {
  const fd = new FormData()
  if (activeIngredient) fd.append('active_ingredient', activeIngredient)
  return post<OpenFdaResult>('/openfda', fd)
}

export async function uploadPatientCase(file: File): Promise<PatientUploadResult> {
  const fd = new FormData()
  fd.append('file', file)
  return post<PatientUploadResult>('/upload-patient-case', fd)
}

export async function analyzeSession(): Promise<AnalyzeResult> {
  return post<AnalyzeResult>('/analyze', null)
}

export async function chatQuestion(question: string): Promise<ChatResult> {
  const fd = new FormData()
  fd.append('question', question)
  return post<ChatResult>('/chat', fd)
}

export async function getPatientStatus(): Promise<PatientStatus> {
  return get<PatientStatus>('/patient-status')
}

export async function getHealth(): Promise<{ status: string }> {
  return get('/health')
}

export async function clearPatientCase(): Promise<{ success: boolean; message: string }> {
  return del<{ success: boolean; message: string }>('/patient-case')
}

// ── Label prettifiers ──────────────────────────────────────────────────

export const DRUG_FIELD_LABELS: Record<string, string> = {
  openfda_brand_name: 'Brand Name',
  openfda_generic_name: 'Generic Name',
  openfda_manufacturer_name: 'Manufacturer',
  purpose: 'Purpose',
  indications_and_usage: 'Indications & Usage',
  dosage_and_administration: 'Dosage & Administration',
  warnings: 'Warnings',
  warnings_and_cautions: 'Warnings & Cautions',
  precautions: 'Precautions',
  contraindications: 'Contraindications',
  adverse_reactions: 'Adverse Reactions',
  drug_interactions: 'Drug Interactions',
  keep_out_of_reach_of_children: 'Keep Out of Reach of Children',
  storage_and_handling: 'Storage & Handling',
}

export const HIGH_PRIORITY_FIELDS = [
  'warnings',
  'warnings_and_cautions',
  'contraindications',
  'drug_interactions',
  'precautions',
]

export const SIMPLE_LABELS: Record<string, string> = {
  openfda_brand_name: 'Brand name',
  openfda_generic_name: 'Generic name',
  openfda_manufacturer_name: 'Manufacturer',
  purpose: 'What it does',
  indications_and_usage: 'Uses',
  dosage_and_administration: 'How to use it',
  warnings: 'Warnings',
  warnings_and_cautions: 'Warnings',
  precautions: 'Precautions',
  contraindications: 'Do not use if',
  adverse_reactions: 'Possible side effects',
  drug_interactions: 'Drug interactions',
  keep_out_of_reach_of_children: 'Keep away from children',
  storage_and_handling: 'Storage',
}
