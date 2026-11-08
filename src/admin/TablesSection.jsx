import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import qrcode from 'qrcode-generator'
import { ArrowDown, ArrowUp, Check, Download, Pencil, RefreshCw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { useDialog } from '../utils/useDialog'
import { formatCents } from '../pos/money'
import { cleanTableLabel, moveTable, posErrorMessage, tableQrUrl } from './adminData'
import { useAdminSync } from './useAdminSync'

function QrDialog({ table, token, onRotate, onClose }) {
  const dialogRef = useDialog(onClose)
  const url = tableQrUrl(token, window.location.origin, import.meta.env.BASE_URL)
  const image = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(url)
    code.make()
    return code.createDataURL(8, 16)
  }, [url])

  return (
    <div className="ad-dialog-backdrop" onClick={onClose}>
      <section className="ad-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${table.label} QR kodu`} onClick={event => event.stopPropagation()}>
        <div className="ad-card-head"><h2>{table.label} QR kodu</h2><button type="button" className="pos-icon-btn" onClick={onClose} aria-label="Kapat"><X size={18} /></button></div>
        <img className="ad-qr" src={image} alt={`${table.label} QR kodu`} />
        <p className="pos-muted">Kod bu masaya özeldir. Yalnızca masaya yerleştirin; paylaşmayın.</p>
        <div className="ad-row-actions">
          <a className="pos-btn pos-btn-primary" href={image} download={`waypoint-${table.label}.gif`}><Download size={16} aria-hidden="true" /> İndir</a>
          <button type="button" className="pos-btn pos-btn-ghost ad-copy" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success('Bağlantı kopyalandı.'), () => toast.error('Kopyalanamadı.'))}>Bağlantıyı kopyala</button>
          <button type="button" className="pos-btn pos-btn-ghost ad-rotate" onClick={onRotate}><RefreshCw size={16} aria-hidden="true" /> Kodu yenile</button>
        </div>
      </section>
    </div>
  )
}

export default function TablesSection() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [label, setLabel] = useState('')
  const [qrFor, setQrFor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // { id, value }

  const load = useCallback(async () => {
    const [tables, tokens, bills] = await Promise.all([
      supabase.from('restaurant_tables').select('id, label, sort_order, is_active').order('sort_order').order('label'),
      supabase.from('table_qr_tokens').select('table_id, token'),
      supabase.from('bill_summaries').select('table_id, session_id, total_cents, balance_cents, order_count').eq('status', 'open'),
    ])
    if (tables.error || tokens.error || bills.error) return setError(true)
    setError(false)
    setData({ tables: tables.data, tokens: new Map(tokens.data.map(row => [row.table_id, row.token])), bills: new Map(bills.data.map(row => [row.table_id, row])) })
  }, [])
  const { refresh } = useAdminSync(load)
  const closeQr = useCallback(() => setQrFor(null), [])

  async function run(action, success) {
    setBusy(true)
    let failure
    try { ({ error: failure } = await action()) } catch (error) { failure = error } finally { setBusy(false) }
    if (failure) toast.error(posErrorMessage(failure))
    else if (success) toast.success(success)
    await load()
    refresh()
    return !failure
  }

  async function addTable(event) {
    event.preventDefault()
    const name = cleanTableLabel(label)
    if (!name) return
    const sort = Math.max(0, ...data.tables.map(table => table.sort_order)) + 1
    if (await run(() => supabase.from('restaurant_tables').insert({ label: name, sort_order: sort }), `${name} eklendi.`)) setLabel('')
  }

  const setActive = table => {
    if (table.is_active && !window.confirm(`${table.label} kullanım dışı bırakılsın mı? Garson ve müşteri ekranlarında görünmez, QR kodu çalışmaz; geçmiş kayıtları korunur. İstediğiniz zaman geri alabilirsiniz.`)) return
    run(() => supabase.from('restaurant_tables').update({ is_active: !table.is_active }).eq('id', table.id), table.is_active ? `${table.label} kullanım dışı.` : `${table.label} yeniden kullanımda.`)
  }
  // Ad değişir, masa kimliği ve QR kodu aynı kalır: basılı QR aynı masaya gitmeye devam eder.
  async function rename(table) {
    const name = cleanTableLabel(editing?.value)
    if (!name || name === table.label) return setEditing(null)
    if (await run(() => supabase.from('restaurant_tables').update({ label: name }).eq('id', table.id), `${table.label} → ${name}`)) setEditing(null)
  }
  const move = (table, direction) => run(async () => {
    for (const row of moveTable(data.tables.filter(item => item.is_active), table.id, direction)) {
      const { error: failure } = await supabase.from('restaurant_tables').update({ sort_order: row.sort_order }).eq('id', row.id)
      if (failure) return { error: failure }
    }
    return { error: null }
  })
  const rotate = table => {
    if (window.confirm(`${table.label} için eski QR kodu geçersiz olacak. Devam edilsin mi?`)) run(() => supabase.rpc('rotate_table_qr_token', { p_table_id: table.id }), 'QR kodu yenilendi.')
  }
  const forceClose = (table, bill) => {
    if (window.confirm(`${table.label} kalan ${formatCents(Number(bill.balance_cents))} bakiyeyle zorla kapatılsın mı? Denetim kaydına yazılır.`)) {
      run(() => supabase.rpc('close_table_session', { p_session_id: bill.session_id, p_force: true }), `${table.label} kapatıldı.`)
    }
  }

  const active = data?.tables.filter(table => table.is_active) ?? []
  const inactive = data?.tables.filter(table => !table.is_active) ?? []

  return (
    <main className="ad-page fade-in">
      <div className="ad-page-head"><h1 className="pos-title">Masalar</h1></div>
      <form className="ad-card ad-inline-form" onSubmit={addTable}>
        <label className="input-label" htmlFor="ad-new-table">Yeni masa</label>
        <div className="ad-row-actions">
          <input id="ad-new-table" className="input" value={label} maxLength={40} placeholder="Örn. Masa 14, Bahçe 1, Teras" onChange={event => setLabel(event.target.value)} />
          <button type="submit" className="pos-btn pos-btn-primary ad-add-table" disabled={busy || !label.trim() || !data}>Ekle</button>
        </div>
      </form>
      {error && <p className="pos-alert" role="alert">Masalar alınamadı. Otomatik olarak yeniden denenecek.</p>}
      {!data && !error && <div className="loading-screen" role="status"><div className="spinner" />Yükleniyor…</div>}
      {data && <p className="pos-muted ad-tables-count">{active.length} masa kullanımda{inactive.length ? ` · ${inactive.length} kullanım dışı` : ''}</p>}
      <ul className="ad-tables">
        {active.map((table, index) => renderTable(table, index, active.length))}
      </ul>
      {inactive.length > 0 && (
        <details className="ad-card ad-inactive">
          <summary>Kullanım dışı masalar ({inactive.length})</summary>
          <ul className="ad-tables">{inactive.map(table => renderTable(table))}</ul>
        </details>
      )}
      {qrFor && data.tokens.has(qrFor.id) && <QrDialog table={qrFor} token={data.tokens.get(qrFor.id)} onRotate={() => rotate(qrFor)} onClose={closeQr} />}
    </main>
  )

  function renderTable(table, index, count) {
          const bill = data.bills.get(table.id)
          const isEditing = editing?.id === table.id
          return (
            <li key={table.id} className={`ad-table${table.is_active ? '' : ' inactive'}`} data-table={table.label}>
              {isEditing ? (
                <form className="ad-rename" onSubmit={event => { event.preventDefault(); rename(table) }}>
                  <label className="sr-only" htmlFor={`ad-rename-${table.id}`}>Masa adı</label>
                  <input id={`ad-rename-${table.id}`} className="input" value={editing.value} maxLength={40} autoFocus placeholder="Örn. Bahçe 1, Teras, Loca"
                    onChange={event => setEditing({ id: table.id, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') setEditing(null) }} />
                  <button type="submit" className="pos-icon-btn" disabled={busy || !cleanTableLabel(editing.value)} aria-label="Adı kaydet"><Check size={17} /></button>
                  <button type="button" className="pos-icon-btn" onClick={() => setEditing(null)} aria-label="Vazgeç"><X size={17} /></button>
                </form>
              ) : (
                <div className="ad-order-head">
                  <strong>{table.label}</strong>
                  <button type="button" className="pos-icon-btn ad-rename-btn" disabled={busy} onClick={() => setEditing({ id: table.id, value: table.label })} aria-label={`${table.label} adını değiştir`}><Pencil size={15} /></button>
                  <span className={`ad-channel-tag${bill ? ' busy' : ''}`}>{!table.is_active ? 'Kullanım dışı' : bill ? 'Açık adisyon' : 'Boş'}</span>
                  {table.is_active && count > 1 && (
                    <span className="ad-order-btns">
                      <button type="button" className="pos-icon-btn" disabled={busy || index === 0} onClick={() => move(table, -1)} aria-label={`${table.label} yukarı`}><ArrowUp size={15} /></button>
                      <button type="button" className="pos-icon-btn" disabled={busy || index === count - 1} onClick={() => move(table, 1)} aria-label={`${table.label} aşağı`}><ArrowDown size={15} /></button>
                    </span>
                  )}
                </div>
              )}
              {bill && <p className="ad-bill-line">{bill.order_count} sipariş · Toplam {formatCents(Number(bill.total_cents))} · Kalan {formatCents(Number(bill.balance_cents))}</p>}
              <div className="ad-row-actions">
                <button type="button" className="pos-btn pos-btn-ghost ad-qr-open" disabled={!data.tokens.has(table.id)} onClick={() => setQrFor(table)}>QR kodu</button>
                {table.is_active && <Link className="pos-btn pos-btn-ghost" to={`/garson/masa/${table.id}`}>Adisyon</Link>}
                <button type="button" className="pos-btn pos-btn-ghost ad-toggle-table" disabled={busy || (table.is_active && Boolean(bill))} title={bill ? 'Açık adisyonu olan masa kullanım dışı bırakılamaz' : undefined} onClick={() => setActive(table)}>{table.is_active ? 'Kullanım dışı bırak' : 'Yeniden kullan'}</button>
                {bill && <button type="button" className="pos-btn pos-btn-ghost ad-force-close" disabled={busy} onClick={() => forceClose(table, bill)}>Zorla kapat</button>}
              </div>
            </li>
          )
  }
}
