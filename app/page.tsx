'use client';
const [code, setCode] = useState('');


const lastUpdDisplay = useMemo(() => {
if (!lastUpdated) return '—';
const d = new Date(lastUpdated);
return d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
}, [lastUpdated]);


return (
<div style={{ padding: 24, display: 'grid', gap: 16 }}>
<header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
<h1 style={{ fontSize: 20, fontWeight: 600 }}>Hotel Availability Matrix</h1>
<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
<button onClick={updateMatrix} disabled={loading || hotels.length === 0} style={{ padding: '8px 12px' }}>
{loading ? 'Updating…' : 'Update'}
</button>
<span style={{ color: '#666' }}>Last updated: {lastUpdDisplay}</span>
</div>
</header>


<section>
<h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Manage Hotels</h2>
<div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
<input placeholder="Hotel name" value={name} onChange={(e) => setName(e.target.value)} />
<input placeholder="Hotel code" value={code} onChange={(e) => setCode(e.target.value)} />
<button onClick={() => { if (name && code) { addHotel(name, code); setName(''); setCode(''); } }}>Add</button>
</div>
<ul style={{ fontSize: 14 }}>
{hotels.map(h => (
<li key={h.code} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
<span style={{ width: 260 }}>{h.name}</span>
<span style={{ width: 180, color: '#666' }}>{h.code}</span>
<button onClick={() => removeHotel(h.code)} style={{ color: '#b00020' }}>Remove</button>
</li>
))}
{hotels.length === 0 && (
<li style={{ color: '#666' }}>Add hotels to begin.</li>
)}
</ul>
</section>


<section style={{ overflowX: 'auto' }}>
<table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
<thead>
<tr>
<th style={{ border: '1px solid #ddd', padding: 8, background: '#f7f7f7', position: 'sticky', left: 0, zIndex: 1 }}>Hotel</th>
{dates.map((d) => (
<th key={d} style={{ border: '1px solid #ddd', padding: 8, background: '#f7f7f7', whiteSpace: 'nowrap' }}>{d}</th>
))}
</tr>
</thead>
<tbody>
{hotels.map((h) => (
<tr key={h.code}>
<td style={{ border: '1px solid #ddd', padding: 8, background: '#fff', position: 'sticky', left: 0 }}>{h.name} <span style={{ color: '#777', fontSize: 12 }}>({h.code})</span></td>
{dates.map((d) => {
const state = cells[h.code]?.[d] || 'red';
const bg = state === 'green' ? '#22c55e' : '#ef4444';
return (
<td key={d} style={{ border: '1px solid #eee', padding: 8, textAlign: 'center' }}>
<span title={state} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: bg }} />
</td>
);
})}
</tr>
))}
</tbody>
</table>
</section>
</div>
);
}
