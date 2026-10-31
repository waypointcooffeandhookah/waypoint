import { FlaskConical, LogOut } from 'lucide-react'

// Personel ekranlarının ortak başlığı: QR menü başlığıyla aynı marka dili.
export default function PosHeader({ subtitle, staff, demo, demoLink, onResetDemo, onSignOut, actions, children }) {
  return (
    <header className="pos-header">
      <div className="pos-header-row">
        <div className="pos-brand">
          <img src={`${import.meta.env.BASE_URL}logo-balanced.png`} alt="" className="pos-brand-logo" />
          <div className="pos-brand-text">
            <span className="pos-brand-name">WAYPOINT</span>
            <span className="pos-brand-sub">{subtitle}</span>
          </div>
        </div>
        {staff && (
          <div className="pos-header-actions">
            {actions}
            <span className="pos-staff-chip" title={staff.name}>{staff.name}</span>
            <button type="button" className="pos-icon-btn" onClick={onSignOut} aria-label="Çıkış yap">
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
      {children}
      {demo && (
        <div className="pos-demo-banner" role="note">
          <FlaskConical size={15} aria-hidden="true" />
          <span>
            <strong>DEMO MODU</strong> · Veriler yalnızca bu tarayıcıda. Sipariş gerçek mutfağa veya başka bir cihaza gitmez, veritabanına yazılmaz.
            {' '}{demoLink && <a href={`${import.meta.env.BASE_URL}${demoLink.path}?demo`} target="_blank" rel="noreferrer">{demoLink.label}</a>}
            {' '}{onResetDemo && <button type="button" onClick={onResetDemo}>Demoyu sıfırla</button>}
          </span>
        </div>
      )}
    </header>
  )
}
