import StaffLogin from './StaffLogin'

function Screen({ children }) {
  return <div className="loading-screen pos-screen" role="status">{children}</div>
}

// Personel ekranlarının ortak kapısı. Rol kontrolü yalnızca doğru ekranı göstermek içindir;
// asıl yetki sunucuda (RLS + RPC) doğrulanır.
export default function PosGate({ session, area, children }) {
  const { mode, staff, backend, catalog, catalogError } = session
  const catalogMissing = area.needsCatalog || mode === 'demo'

  if (mode === null) return <Screen><div className="spinner" />{area.name} hazırlanıyor…</Screen>
  if (mode === 'unreachable' || (catalogError && catalogMissing)) {
    return (
      <Screen>
        <p>Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.</p>
        <button type="button" className="pos-btn pos-btn-primary" onClick={session.retry}>Tekrar dene</button>
      </Screen>
    )
  }
  if (staff === undefined) return <Screen><div className="spinner" />Oturum kontrol ediliyor…</Screen>
  if (!staff) return <StaffLogin demo={mode === 'demo'} area={area} onSignedIn={session.setStaff} onStartDemo={session.startDemo} />
  if (!area.roles.includes(staff.role)) {
    return (
      <Screen>
        <p>Bu hesabın {area.name.toLocaleLowerCase('tr')} yetkisi bulunmuyor.</p>
        <button type="button" className="pos-btn pos-btn-ghost" onClick={session.signOut}>Çıkış yap</button>
      </Screen>
    )
  }
  if (!backend || (catalogMissing && !catalog)) return <Screen><div className="spinner" />Menü yükleniyor…</Screen>
  return children
}
