import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../../lib/cn'
import { formatRupees } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { ErrorBlock, LoadingBlock } from '../../farmer/components/LoadState'
import { adminApi, dateTime } from '../adminApi'
import { AdminPage, Notice } from '../components/ui'

const GROUPS = [
  { id: 'farmer', n: '01', title: 'Farmer', note: 'Same rate everywhere. Paid by UPI after each verified pickup.' },
  { id: 'baler', n: '02', title: 'Baler pay', note: 'Every cost is paid by what causes it, so far jobs pay more. Raise driving and haul when diesel goes up.' },
  { id: 'clustering', n: '03', title: 'Clusters', note: 'Changing these re-runs clustering for open listings. Ordered clusters are not touched.' },
  { id: 'impact', n: '04', title: 'Impact', note: 'Used for the CO₂ figures shown to farmers and buyers.' },
]

function Field({ f, value, saved, defaultValue, error, onChange }) {
  const changed = value !== '' && Number(value) !== saved
  return (
    <div className="border-b border-soil/12 py-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={f.path} className="min-w-0">
          <span className="block font-semibold">{f.label}</span>
          <span className="label text-xs text-stone">
            {f.unit} · default {defaultValue}
          </span>
        </label>
        <span className={cn('flex items-center border-b-2 bg-paper-light', error ? 'border-danger' : changed ? 'border-straw' : 'border-soil/40', 'focus-within:border-forest')}>
          <input
            id={f.path}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(f.path, e.target.value.replace(/[^\d.]/g, ''))}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${f.path}-error` : undefined}
            className="display h-11 w-[110px] bg-transparent px-2 text-right text-3xl outline-none"
          />
        </span>
      </div>
      {changed && !error && (
        <p className="label mt-1 text-right text-xs text-straw-dark">
          was {saved} → {value}
        </p>
      )}
      {error && (
        <p id={`${f.path}-error`} className="mt-1 text-right text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function Preview({ current, draft, dirty, pending, blocked }) {
  const rows = draft ?? current
  return (
    <section aria-labelledby="preview-title" className="bg-forest-deep p-5 text-paper">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="preview-title" className="label text-sage">
          {blocked ? 'Fix the highlighted fields to preview' : dirty && draft ? 'Preview · your changes' : 'What these rates mean · now'}
        </h2>
        {pending && <span className="label text-xs text-sage">Updating…</span>}
      </div>
      <p className="mt-1.5 text-[13px] text-sage-light">Sample job: {rows[0].tonnes} t from {rows[0].farmCount} farms, delivered to a plant at three distances.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3">
        {rows.map((s, i) => {
          const before = current[i]
          const diff = s.perTonne - before.perTonne
          const covers = s.balerMargin > 0
          return (
            <div key={s.key} className="border border-paper/15 p-3.5">
              <p className="label text-xs text-sage">{s.label}</p>
              <p className="mt-1.5 flex items-baseline gap-2">
                <span className="display text-4xl text-straw-light">{formatRupees(s.perTonne)}</span>
                <span className="text-[12px] text-sage-light">/ t delivered</span>
              </p>
              {dirty && diff !== 0 && (
                <p className={cn('label mt-0.5 text-xs', diff > 0 ? 'text-straw' : 'text-sage-light')}>
                  {diff > 0 ? '+' : '−'}
                  {formatRupees(Math.abs(diff))} vs now
                </p>
              )}
              <dl className="mt-2 text-[12px]">
                {[
                  ['Farmers', s.farmers],
                  ['Baler', s.baler],
                  ['Fuel advance', s.advance],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-t border-paper/10 py-1">
                    <dt className="text-sage-light">{k}</dt>
                    <dd className="tabular-nums">{formatRupees(v)}</dd>
                  </div>
                ))}
              </dl>
              <p className={cn('mt-2 text-[12px]', covers ? 'text-sage-light' : 'font-semibold text-[#f4b7a8]')}>
                {covers ? `✓ Covers diesel + twine (≈ ${formatRupees(s.balerCost)})` : `✕ Below diesel + twine (≈ ${formatRupees(s.balerCost)}): baler would lose money`}
              </p>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-[12px] leading-normal text-sage">Running cost is a rough guide (diesel per km + twine and fuel per tonne). Baler pay also has to cover labour and the machine.</p>
    </section>
  )
}

function AuditLog({ entries }) {
  return (
    <section aria-labelledby="audit-title">
      <h2 id="audit-title" className="display text-3xl">
        Change log
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 border border-dashed border-soil/30 p-5 text-center text-sm text-stone-dark">No admin changes yet.</p>
      ) : (
        <ol className="mt-3 border-t-2 border-forest">
          {entries.map((e) => (
            <li key={e.id} className="border-b border-soil/12 py-3">
              <p className="label flex flex-wrap justify-between gap-2 text-xs text-stone">
                <span>
                  {e.action} · {e.actor}
                </span>
                <span>{dateTime(e.at)}</span>
              </p>
              <p className="mt-1 text-sm">{e.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default function AdminSettingsPage() {
  const settings = useAsync((signal) => adminApi.settings(signal))
  const audit = useAsync((signal) => adminApi.audit(signal))
  const [draft, setDraft] = useState(null) // { path: string }
  const [errors, setErrors] = useState({})
  const [preview, setPreview] = useState(null)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  const data = settings.data
  const fromValues = (values) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]))
  // Fill the form whenever fresh settings arrive (first load and after each save).
  useEffect(() => {
    if (data) setDraft(fromValues(data.values))
  }, [data])

  const changes = useMemo(() => {
    if (!data || !draft) return []
    return data.fields.filter((f) => draft[f.path] !== '' && Number(draft[f.path]) !== data.values[f.path]).map((f) => ({ ...f, from: data.values[f.path], to: Number(draft[f.path]) }))
  }, [data, draft])
  const dirty = changes.length > 0

  // Live preview from the server's own pricing code, a moment after typing stops.
  useEffect(() => {
    if (!dirty) {
      setPreview(null)
      setErrors({})
      return
    }
    const controller = new AbortController()
    const body = Object.fromEntries(changes.map((c) => [c.path, c.to]))
    const id = setTimeout(async () => {
      setPending(true)
      try {
        const r = await adminApi.preview(body, controller.signal)
        setPreview(r.samples)
        setErrors({})
      } catch (err) {
        if (err.name !== 'AbortError') {
          setPreview(null)
          setErrors(err.details?.fields ?? { form: err.message })
        }
      } finally {
        if (!controller.signal.aborted) setPending(false)
      }
    }, 350)
    return () => {
      clearTimeout(id)
      controller.abort()
    }
  }, [changes, dirty])

  function onChange(path, value) {
    setConfirming(false)
    setNotice(null)
    setDraft((d) => ({ ...d, [path]: value }))
  }

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      const body = Object.fromEntries(changes.map((c) => [c.path, c.to]))
      const r = await adminApi.saveSettings(body)
      const rebuild = r.changes.some((c) => c.path.startsWith('clustering.'))
      setNotice({ text: `Saved ${r.changes.length} change${r.changes.length === 1 ? '' : 's'}. New orders use these rates${rebuild ? '; clusters are being rebuilt' : ''}.` })
      setPreview(null)
      setConfirming(false)
      settings.reload()
      audit.reload()
    } catch (err) {
      setErrors(err.details?.fields ?? {})
      setNotice({ text: err.message, error: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminPage
      title="Rate card"
      aside={data && <span className="label text-stone">{data.updatedAt ? `Last changed ${dateTime(data.updatedAt)} · ${data.updatedBy}` : 'Using default rates'}</span>}
    >
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {settings.loading && !data && <LoadingBlock />}
      {settings.error && <ErrorBlock error={settings.error} onRetry={settings.reload} />}

      {data && draft && (
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)] lg:gap-10">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (dirty && !Object.keys(errors).length) setConfirming(true)
            }}
            noValidate
            className="grid min-w-0 content-start gap-7"
          >
            {GROUPS.map((g) => (
              <fieldset key={g.id} className="min-w-0">
                <legend className="flex w-full items-baseline gap-3 border-b-2 border-forest pb-2">
                  <span className="label text-straw-dark">{g.n}</span>
                  <span className="display text-3xl">{g.title}</span>
                </legend>
                <p className="mt-2 text-[13px] text-stone-dark">{g.note}</p>
                <div className={cn(g.id === 'baler' && 'sm:grid sm:grid-cols-2 sm:gap-x-8')}>
                  {data.fields
                    .filter((f) => f.group === g.id)
                    .map((f) => (
                      <Field key={f.path} f={f} value={draft[f.path]} saved={data.values[f.path]} defaultValue={data.defaults[f.path]} error={errors[f.path]} onChange={onChange} />
                    ))}
                </div>
              </fieldset>
            ))}

            <div className="sticky bottom-0 z-10 -mx-[clamp(16px,3vw,40px)] border-t border-soil/15 bg-paper/95 px-[clamp(16px,3vw,40px)] py-3 backdrop-blur-sm lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              {confirming ? (
                <div className="border-l-[3px] border-straw bg-husk p-4">
                  <p className="font-semibold">Save {changes.length} change{changes.length === 1 ? '' : 's'}?</p>
                  <ul className="mt-1.5 text-sm text-stone-dark">
                    {changes.map((c) => (
                      <li key={c.path}>
                        {c.label}: {c.from} → <strong className="text-soil">{c.to}</strong> {c.unit}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[13px] text-stone-dark">Orders already placed keep their old rates. The change is logged.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={save} disabled={saving} className="label min-h-12 bg-forest px-5 text-paper hover:bg-forest-deep disabled:opacity-60">
                      {saving ? 'Saving…' : 'Yes, save'}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="label min-h-12 border border-soil/30 px-5 hover:bg-paper">
                      Keep editing
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" disabled={!dirty || Object.keys(errors).length > 0} className="label min-h-12 bg-straw px-5 text-forest-deep hover:bg-straw-light disabled:bg-husk disabled:text-stone">
                    {dirty ? `Review ${changes.length} change${changes.length === 1 ? '' : 's'} →` : 'No changes'}
                  </button>
                  {dirty && (
                    <button type="button" onClick={() => setDraft(fromValues(data.values))} className="label min-h-12 border border-soil/30 px-4 hover:bg-husk">
                      Undo all
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false)
                      setDraft(fromValues(data.defaults))
                    }}
                    className="label min-h-12 px-3 text-stone underline-offset-4 hover:underline"
                  >
                    Fill in defaults
                  </button>
                  {errors.form && <p className="w-full text-[13px] text-danger">{errors.form}</p>}
                </div>
              )}
            </div>
          </form>

          <div className="grid min-w-0 content-start gap-8 lg:sticky lg:top-24 lg:self-start">
            <Preview current={data.samples} draft={preview} dirty={dirty} pending={pending} blocked={Object.keys(errors).length > 0} />
            {audit.data && <AuditLog entries={audit.data.entries} />}
            {audit.error && <ErrorBlock error={audit.error} onRetry={audit.reload} />}
          </div>
        </div>
      )}
    </AdminPage>
  )
}
