import { Component } from 'react'

import { isChunkLoadError, reloadOnce } from './utils/chunkReload'

// Bir ekrandaki beklenmedik hata bütün uygulamayı beyaz ekrana çevirmez; personel tek dokunuşla devam eder.
// resetKey (adres) değişince sınır kendini sıfırlar: başka ekrana geçmek yeterlidir.
export default class AppErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error) {
    return { error }
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error, info) {
    console.error('[Waypoint] ekran hatası', error, info?.componentStack)
    if (isChunkLoadError(error)) reloadOnce()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const update = isChunkLoadError(error)
    return (
      <div className="app-crash" role="alert">
        <img src={`${import.meta.env.BASE_URL}logo-mark-144.webp`} alt="" width="72" height="72" />
        <h1>{update ? 'Yeni sürüm yükleniyor' : 'Bir sorun oluştu'}</h1>
        <p>{update
          ? 'Uygulama güncellendi. Sayfa yenilenince kaldığınız yerden devam edersiniz; verileriniz kaybolmaz.'
          : 'Bu ekran beklenmedik bir hata verdi. Siparişler ve adisyonlar sunucuda güvende; sayfayı yenileyip devam edebilirsiniz.'}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Sayfayı yenile</button>
      </div>
    )
  }
}
