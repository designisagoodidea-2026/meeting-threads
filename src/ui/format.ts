import { localMinutes } from '../data/load'
import type { Meeting, Model } from '../data/types'

export const hm = (d: Date, tz: string) => {
  const m = localMinutes(d, tz)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
const wdFormats = new Map<string, Intl.DateTimeFormat>()
const wd = (d: Date, tz: string) => {
  if (!wdFormats.has(tz)) wdFormats.set(tz, new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }))
  return wdFormats.get(tz)!.format(d)
}

export const when = (m: Meeting, tz: string) => `${wd(m.start, tz)}, ${hm(m.start, tz)}`
export const firstName = (model: Model, id: string) => model.people.get(id)?.name.split(' ')[0] ?? id
export const names = (model: Model, ids: string[], max = 3) => {
  const n = ids.map((id) => firstName(model, id))
  return n.length > max ? [...n.slice(0, max), `+${n.length - max}`] : n
}
export const speakerName = (model: Model, id: string | null) => (id ? (model.people.get(id)?.name ?? id) : 'Unknown speaker')
export const offset = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
