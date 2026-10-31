import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, RefreshCw, ShoppingBag } from 'lucide-react'
import { formatCents } from '../money'
import { cartCount } from '../cart'
import { useOrderSync } from '../useOrderSync'

const FILTERS = [['all', 'Tümü'], ['occupied', 'Dolu'], ['free', 'Boş']]
const REFRESH_MS = 20000

export default function TableGrid({ backend, carts }) {
  const navigate = useNavigate()
  const [tables, setTables] = useState(null)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setTables(await backend.listTables())
      setError(false)
    } catch {
      setError(true)
    }
  }, [backend])

  const refresh = () => {
    setRefreshing(true)
    load().finally(() => setRefreshing(false))
  }

  useOrderSync(backend, load, REFRESH_MS)

  const occupied = tables?.filter(table => table.occupied).length ?? 0
  const visible = (tables ?? []).filter(table => filter === 'all' || (filter === 'occupied') === table.occupied)

  return (
    <main className="wt-page fade-in">
      <div className="wt-toolbar">
        <div>
          <h1 className="pos-title">Masalar</h1>
          {tables && <p className="pos-muted">{occupied} dolu · {tables.length - occupied} boş</p>}
        </div>
        <button type="button" className="pos-icon-btn" onClick={refresh} aria-label="Masaları yenile" disabled={refreshing}>
          <RefreshCw size={18} className={refreshing ? 'pos-spin' : ''} />
        </button>
      </div>

      <div className="pos-chips" role="tablist" aria-label="Masa filtresi">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value}
            className={`pos-chip${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      {error && <p className="pos-alert" role="alert">Masalar yüklenemedi. Bağlantı geri geldiğinde otomatik yenilenecek. <button type="button" onClick={refresh}>Tekrar dene</button></p>}
      {!tables && !error && <div className="loading-screen" role="status"><div className="spinner" />Masalar yükleniyor…</div>}

      <ul className="wt-table-grid">
        {visible.map(table => {
          const pending = cartCount(carts[table.id] ?? { lines: [] })
          return (
            <li key={table.id}>
              <button type="button" className={`wt-table-card${table.occupied ? ' occupied' : ''}${table.readyCount > 0 ? ' has-ready' : ''}`} onClick={() => navigate(`masa/${table.id}`)}>
                <span className="wt-table-top">
                  <span className={`wt-table-status${table.occupied ? ' occupied' : ''}`}>{table.occupied ? 'Dolu' : 'Boş'}</span>
                  {pending > 0 && <span className="wt-table-pending" title="Gönderilmemiş sepet"><ShoppingBag size={12} aria-hidden="true" />{pending}</span>}
                </span>
                {table.readyCount > 0 && <span className="wt-table-ready"><BellRing size={12} aria-hidden="true" />{table.readyCount} sipariş hazır</span>}
                <span className="wt-table-label">{table.label}</span>
                <span className="wt-table-meta">
                  {table.occupied ? <><strong>{formatCents(table.totalCents)}</strong> · {table.orderCount} sipariş</> : 'Sipariş yok'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {tables && visible.length === 0 && <div className="empty-state"><h3>Bu filtrede masa yok</h3></div>}
    </main>
  )
}
