import type { IdentityOcrAssessment } from './lib/identity-ocr'

export function IdentityOcrReport({ assessment, error }: {
  assessment?: IdentityOcrAssessment | null
  error?: string | null
}) {
  if (!assessment && !error) return null
  return <div className="card identity-ocr-report" aria-live="polite">
    <h3>Document text check</h3>
    {error ? <p className="sub">Text scanning could not finish: {error}</p> : null}
    {assessment ? <>
      <p className="sub">Tesseract read {assessment.pages} page{assessment.pages === 1 ? '' : 's'} with about {Math.round(assessment.confidence)}% text confidence.</p>
      <ul>
        {assessment.checks.map(check => <li key={check.label}>{check.found ? '✓' : '!' } {check.label}: {check.found ? 'found' : 'not found'}</li>)}
      </ul>
      {assessment.warnings.map(warning => <p className="hint" key={warning}>{warning}</p>)}
    </> : null}
    <p className="hint">OCR can misread a real ID and cannot establish authenticity.</p>
  </div>
}
