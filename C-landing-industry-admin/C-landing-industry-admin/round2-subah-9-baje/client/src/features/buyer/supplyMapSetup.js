/**
 * Real-map supply view for buyers (Leaflet, loaded on demand).
 * Clusters are squares sized by tonnes: solid = ready to order, dashed = forming.
 */
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const formatRupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

export function createSupplyMap(container, { plant, onSelect }) {
  const map = L.map(container, { center: [plant.lat, plant.lng], zoom: 10, scrollWheelZoom: true, zoomControl: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map)

  L.marker([plant.lat, plant.lng], {
    keyboard: false,
    zIndexOffset: 1000,
    icon: L.divIcon({
      className: 'pl-plant-icon',
      iconSize: null,
      html: `<span class="pl-plant"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D8A532" stroke-width="2.2" stroke-linecap="square"><path d="M3 21V11l6 3v-3l6 3V5h6v16Z"/></svg>Your plant</span>`,
    }),
  }).addTo(map)

  const layer = L.layerGroup().addTo(map)
  let fitted = false

  function setClusters(clusters, selectedId, isVisible) {
    layer.clearLayers()
    clusters.forEach((c) => {
      const size = Math.round(24 + Math.min(c.totalTonnes, 120) / 4)
      const classes = ['pl-cluster', c.status === 'ready' ? 'is-ready' : 'is-forming', c.id === selectedId ? 'is-selected' : '', isVisible(c) ? '' : 'is-dim'].join(' ')
      const marker = L.marker([c.center.lat, c.center.lng], {
        keyboard: true,
        title: `${c.place} · ${c.totalTonnes} t · ${formatRupees(c.price.perTonne)}/t delivered · ${c.status}`,
        zIndexOffset: c.id === selectedId ? 900 : 0,
        icon: L.divIcon({
          className: 'pl-cluster-icon',
          iconSize: [size, size],
          html: `<span class="${classes}" style="width:${size}px;height:${size}px">${Math.round(c.totalTonnes)}</span><span class="pl-cluster-label">${formatRupees(c.price.perTonne)}</span>`,
        }),
      })
      marker.on('click', () => onSelect(c.id))
      marker.on('keypress', (e) => e.originalEvent.key === 'Enter' && onSelect(c.id))
      marker.addTo(layer)
    })

    if (!fitted && clusters.length) {
      fitted = true
      const bounds = L.latLngBounds([[plant.lat, plant.lng], ...clusters.map((c) => [c.center.lat, c.center.lng])])
      map.fitBounds(bounds, { padding: [48, 48] })
    }
  }

  return { setClusters, destroy: () => map.remove() }
}
