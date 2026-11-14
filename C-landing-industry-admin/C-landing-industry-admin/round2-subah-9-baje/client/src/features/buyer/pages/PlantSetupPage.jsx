import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SlabButton } from '../../../components/ui/SlabButton'
import { useAuth } from '../../auth/AuthContext'
import { FieldError } from '../../auth/components/FieldError'
import { FieldMapPicker } from '../../farmer/components/FieldMapPicker'
import { PUNJAB_DISTRICTS } from '../../farmer/copy'
import { buyerApi, PLANT_TYPES } from '../buyerApi'

const inputClass =
  'mt-1.5 h-13 w-full border-b-2 border-soil bg-paper-light px-3.5 text-lg font-medium outline-none focus:border-forest focus:ring-4 focus:ring-straw/30'

/** One-time setup: where straw should be delivered. Distances and prices are worked out from here. */
export default function PlantSetupPage() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const existing = user.buyer ?? {}
  const [company, setCompany] = useState(existing.company ?? '')
  const [plantType, setPlantType] = useState(existing.plantType ?? '')
  const [district, setDistrict] = useState(existing.district ?? '')
  const [pin, setPin] = useState(existing.plant ?? null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const next = {}
    if (company.trim().length < 2) next.company = 'Enter the company or plant name.'
    if (!plantType) next.plantType = 'Choose the plant type.'
    if (!district) next.district = 'Choose the district.'
    if (!pin) next.pin = 'Mark the plant on the map.'
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    try {
      const data = await buyerApi.saveProfile({ company: company.trim(), plantType, district, lat: pin.lat, lng: pin.lng })
      setUser(data.user)
      navigate('/buyer', { replace: true })
    } catch (err) {
      setErrors({ form: err.message, ...err.details?.fields })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-[clamp(16px,3vw,40px)] py-10">
      <h1 className="display text-[clamp(2.6rem,5vw,4rem)]">
        Where should straw be <span className="accent text-forest">delivered?</span>
      </h1>
      <p className="mt-4 max-w-xl text-stone-dark">
        We use your plant’s location to show supply near you and to work out haul distance and the delivered price of every cluster.
      </p>

      <form onSubmit={submit} noValidate className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid content-start gap-1">
          <label htmlFor="company" className="label text-stone-dark">
            Company / plant name
          </label>
          <input id="company" value={company} onChange={(e) => setCompany(e.target.value)} aria-invalid={Boolean(errors.company)} aria-describedby="company-error" className={inputClass} />
          <FieldError id="company-error" message={errors.company} />

          <label htmlFor="plantType" className="label text-stone-dark">
            Plant type
          </label>
          <select id="plantType" value={plantType} onChange={(e) => setPlantType(e.target.value)} aria-invalid={Boolean(errors.plantType)} aria-describedby="type-error" className={inputClass}>
            <option value="">Choose…</option>
            {PLANT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <FieldError id="type-error" message={errors.plantType} />

          <label htmlFor="district" className="label text-stone-dark">
            District
          </label>
          <select id="district" value={district} onChange={(e) => setDistrict(e.target.value)} aria-invalid={Boolean(errors.district)} aria-describedby="district-error" className={inputClass}>
            <option value="">Choose…</option>
            {PUNJAB_DISTRICTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <FieldError id="district-error" message={errors.district} />
        </div>

        <div>
          <p className="label text-stone-dark">Plant location · tap the map or drag the pin</p>
          <div className="mt-2">
            <FieldMapPicker value={pin} language="en" onChange={setPin} />
          </div>
          <FieldError id="pin-error" message={errors.pin ?? errors.lat ?? errors.form} />
          <div className="mt-6">
            <SlabButton type="submit" variant="gold" disabled={busy} className="w-full sm:w-auto">
              {busy ? 'Saving…' : 'Save and see supply'}
            </SlabButton>
          </div>
        </div>
      </form>
    </div>
  )
}
