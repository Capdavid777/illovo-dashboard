// inside your component:
const [loading, setLoading] = useState(false)
const [errorMsg, setErrorMsg] = useState('')

// fetch recent entries
async function refresh() {
  setLoading(true)
  setErrorMsg('')
  try {
    const r = await fetch('/api/daily-metrics?debug=1', { cache: 'no-store' })
    const data = await r.json().catch(() => ({}))
    // Defensive defaults so we never crash
    const list = Array.isArray(data.items) ? data.items : []
    setEntries(list)
  } catch (e) {
    console.error(e)
    setEntries([])                  // don’t crash UI
    setErrorMsg('Could not load recent entries.')
  } finally {
    setLoading(false)
  }
}

// on save
async function save() {
  setSaving(true)
  setErrorMsg('')
  try {
    const payload = { date, revenue, target, occupancy, arr, notes }
    const r = await fetch('/api/daily-metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    if (!data.ok) throw new Error(data.error || 'Save failed')
    await refresh()
    setSaveStatus('Saved')
  } catch (e) {
    console.error(e)
    setSaveStatus('Save failed')
    setErrorMsg('Save failed')
  } finally {
    setSaving(false)
  }
}

// when rendering the list
{(entries ?? []).length === 0 ? (
  <div>No data yet.</div>
) : (
  (entries ?? []).map(/* ... */)
)}
