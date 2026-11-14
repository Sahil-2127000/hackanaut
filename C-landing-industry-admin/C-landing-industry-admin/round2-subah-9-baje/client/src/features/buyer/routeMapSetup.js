/**
 * Small real map of a pickup route: numbered farm stops in order, a dashed line
 * through them and on to the buyer's plant. Loaded on demand.
 */
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export function createRouteMap(container, { plant, stops, base, plantLabel = 'Your plant', baseLabel = 'Base' }) {
  const map = L.map(container, { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)

  const path = [...stops.map((s) => [s.position.lat, s.position.lng]), [plant.lat, plant.lng]]
  L.polyline(path, { color: '#1C3324', weight: 3, dashArray: '7 7', opacity: 0.9 }).addTo(map)

  stops.forEach((s, i) => {
    L.marker([s.position.lat, s.position.lng], {
      keyboard: false,
      title: s.label,
      icon: L.divIcon({ className: '', iconSize: [22, 22], html: `<span class="pl-route-stop ${s.state ? `is-${s.state}` : ''}">${s.state === 'done' ? '✓' : i + 1}</span>` }),
    }).addTo(map)
  })
  L.marker([plant.lat, plant.lng], {
    keyboard: false,
    icon: L.divIcon({ className: 'pl-plant-icon', iconSize: null, html: `<span class="pl-plant">${plantLabel}</span>` }),
  }).addTo(map)

  // Baler view: where the machine starts, joined to the first stop (or the end point) with a lighter line.
  if (base) {
    const first = stops.length ? stops[0].position : plant
    L.polyline([[base.lat, base.lng], [first.lat, first.lng]], { color: '#5E6157', weight: 2, dashArray: '3 6', opacity: 0.8 }).addTo(map)
    L.marker([base.lat, base.lng], {
      keyboard: false,
      icon: L.divIcon({ className: 'pl-plant-icon', iconSize: null, html: `<span class="pl-plant" style="background:#5E6157">${baseLabel}</span>` }),
    }).addTo(map)
    path.push([base.lat, base.lng])
  }

  map.fitBounds(L.latLngBounds(path), { padding: [36, 36] })
  return { destroy: () => map.remove() }
}
