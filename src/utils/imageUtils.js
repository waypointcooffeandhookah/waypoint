// ── Turkish Lowercase Helper ──
export function trLower(s) {
  return (s || '').toLocaleLowerCase('tr-TR')
}

// ── Asset URL Resolver (respects Vite base path) ──
export function getAssetUrl(path) {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path
  }
  const clean = path.startsWith('/') ? path.slice(1) : path
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) ? import.meta.env.BASE_URL : '/'
  const normalizedBase = base.endsWith('/') ? base : base + '/'
  if (path.startsWith(normalizedBase)) return path
  if (normalizedBase !== '/' && clean.startsWith(normalizedBase.slice(1))) return `/${clean}`
  return `${normalizedBase}${clean}`
}

// ── Default / Fallback Product Images Map ──
export function getItemImage(item) {
  if (/^https?:\/\//.test(item?.image_url || '')) return item.image_url
  if (trLower(item?.name || '').includes('nescafe') && /3\s*['’]?[üu]\s*1/.test(trLower(item?.name || ''))) return getAssetUrl('images/nescafe.jpg')
  if (/(^|\s)(kola|coca[ -]?cola|cococola)(\s|$)/.test(trLower(item?.name || ''))) return getAssetUrl('images/cocacola.jpg')
  if (item?.image_url) {
    return getAssetUrl(item.image_url)
  }
  const n = trLower(item?.name || '').trim().replace(/^ıce(d)?\s+/, 'ice$1 ')
  if (/^iced? mocha$/.test(n)) return getAssetUrl('images/ice-mocha.jpg')
  if (/^iced? white chocolate (mocha|latte)$/.test(n)) return getAssetUrl('images/ice-white-chocolate-mocha.jpg')
  if (/^iced? (vanilya|vanilyalı|vanilla) latte$/.test(n)) return getAssetUrl('images/ice-vanilya-latte.jpg')
  if (/^iced? (karamel|caramel) latte$/.test(n)) return getAssetUrl('images/ice-karamel-latte.jpg')
  if (n === 'ice latte' || n === 'iced latte') return getAssetUrl('images/ice-latte.jpg')
  if (n === 'ice americano' || n === 'iced americano') return getAssetUrl('images/ice-americano.jpg')
  if (n === 'cedric antep fıstıklı') return getAssetUrl('images/cedric-antep-fistikli.jpg')
  if (n === 'cedric kahve' || n === 'cedric kahveli') return getAssetUrl('images/cedric-kahveli.jpg')
  if (n === 'cedric mango') return getAssetUrl('images/cedric-mango.jpg')
  if (n === 'waffle') return getAssetUrl('images/waffle.jpg')
  if (n === 'tiramisu') return getAssetUrl('images/tiramisu.jpg')
  if (n === 'orman meyveli cup') return getAssetUrl('images/orman-meyveli-cup.jpg')
  if (n === 'lotus cup') return getAssetUrl('images/lotus-cup.jpg')
  if (n.includes('çikolata') && n.includes('frambuaz') && n.includes('mono')) return getAssetUrl('images/cikolata-frambuaz-mono.jpg')
  if (n.includes('incirli') && n.includes('cevizli') && n.includes('mono')) return getAssetUrl('images/incirli-cevizli-mono.jpg')
  if (n === 'mono latte') return getAssetUrl('images/mono-latte.jpg')
  if (n === 'sufle' || n === 'suffle') return getAssetUrl('images/sufle.jpg')
  if (n === 'san sebastian cheesecake') return getAssetUrl('images/san-sebastian-cheesecake.jpg')
  if (n === 'karışık tost') return getAssetUrl('images/karisik-tost.jpg')
  if (n === 'kaşarlı tost') return getAssetUrl('images/kasarli-tost.jpg')
  if (n === 'patso') return getAssetUrl('images/patso.jpg')
  if (n === 'döner' || n === 'doner') return getAssetUrl('images/doner.jpg')
  if (n === 'hamburger') return getAssetUrl('images/hamburger.jpg')
  if (n === 'kumru') return getAssetUrl('images/kumru.jpg')
  if (n === 'patates porsiyon') return getAssetUrl('images/patates-porsiyon.jpg')
  if (n === 'köfte porsiyon') return getAssetUrl('images/kofte-porsiyon.jpg')
  if (n === 'köfte') return getAssetUrl('images/kofte.jpg')
  if (n === 'white chocolate mocha') return getAssetUrl('images/white-chocolate-mocha.jpg')
  if (n === 'vanilya latte' || n === 'vanilyalı latte' || n === 'vanilla latte') return getAssetUrl('images/vanilya-latte.jpg')
  if (n === 'karamel latte' || n === 'caramel latte') return getAssetUrl('images/karamel-latte.jpg')
  if (n === 'latte') return getAssetUrl('images/latte.jpg')
  if (n === 'mocha') return getAssetUrl('images/mocha.jpg')
  if (n === 'americano') return getAssetUrl('images/americano.jpg')
  if (/espresso|esprosso/.test(n)) return getAssetUrl('images/espresso.jpg')
  if (n.includes('nescafe gold')) return getAssetUrl('images/nescafe-gold.jpg')
  if (/menen?gi[çc]/.test(n)) return getAssetUrl('images/menengic.jpg')
  if (n.includes('oralet')) return getAssetUrl('images/oralet.jpg')
  if (n.includes('salep')) return getAssetUrl('images/salep.jpg')
  if (n.includes('sıcak çikolata')) return getAssetUrl('images/sicak-cikolata.jpg')
  if (n === 'çay' || n === 'cay') return getAssetUrl('images/cay.jpg')
  if (n.includes('soda')) return getAssetUrl('images/soda.jpg')
  if (n.includes('limonata')) return getAssetUrl('images/limonata.jpg')
  if (n.includes('ayran')) return getAssetUrl('images/ayran.jpg')
  if (/[şs]algam/.test(n)) return getAssetUrl('images/salgam.jpg')
  if (n === 'burn' || n.startsWith('burn ')) return getAssetUrl('images/burn.jpg')
  if (/red\s*bull/.test(n)) return getAssetUrl('images/redbull.jpg')
  if (/uluda[ğg].*gazoz/.test(n)) return getAssetUrl('images/uludag-gazoz.jpg')
  if (/yedi\s*g[üu]n/.test(n)) return getAssetUrl('images/yedigun.jpg')
  if (n.includes('smoothie')) return getAssetUrl('images/smoothie.jpg')
  if (n.includes('milkshake')) return getAssetUrl('images/milkshake.jpg')
  if (n.includes('çikolata')) return null

  if (n.includes('frozen')) {
    return getAssetUrl('images/frozen.jpg')
  }
  if (n.includes('cool lime')) {
    return getAssetUrl('images/cool-lime.jpg')
  }
  if (/berry hib[ui]scus/.test(n)) {
    return getAssetUrl('images/berry-hibiscus.jpg')
  }

  // Teneke / Kutu Kola
  if (n.includes('teneke kola') || n.includes('kutu kola')) {
    return getAssetUrl('images/cocacola.jpg')
  }

  // Cam / Şişe Kola
  if (n.includes('şişe kola') || n.includes('cam kola') || n.includes('cam şişe')) {
    return getAssetUrl('images/cocacola.jpg')
  }

  // Genel / Ana Kola
  if (n === 'kola' || n === 'coca cola' || n === 'coca-cola') {
    return getAssetUrl('images/cocacola.jpg')
  }

  return null
}

// ── Default Product Descriptions ──
export function getItemDescription(item) {
  if (item?.description) return item.description
  const n = trLower(item?.name || '')
  if (n.includes('çikolata')) return null

  if (n.includes('teneke kola') || n.includes('kutu kola')) {
    return 'Soğuk servis edilen ferahlatıcı kutu teneke kola (330ml)'
  }
  if (n.includes('şişe kola') || n.includes('cam kola')) {
    return 'Buz gibi ferahlatıcı klasik cam şişe kola (250ml)'
  }
  return null
}
