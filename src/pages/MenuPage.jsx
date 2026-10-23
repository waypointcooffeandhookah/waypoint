import { useEffect, useState, useMemo, useRef, useDeferredValue, useCallback, memo } from 'react'
import {
  Search,
  Coffee,
  Flame,
  GlassWater,
  Snowflake,
  Citrus,
  Apple,
  Milk,
  UtensilsCrossed,
  CakeSlice,
  Sparkles,
  ArrowUpRight,
  Layers,
  X,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { trLower, getAssetUrl, getItemImage, getItemDescription } from '../utils/imageUtils'
import './MenuPage.css'
import { readMenuCache, writeMenuCache } from '../utils/menuCache'
import { SUPABASE_URL } from '../config'
import { useDialog } from '../utils/useDialog'
import { WelcomePromotion } from './Promotion'
import { INSTAGRAM_URL, WHATSAPP_URL, normalizeInstagram, normalizeWhatsApp } from '../socialLinks'
const CACHE_KEY = `waypoint-menu-v1:${SUPABASE_URL}`

const priceFormatter = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })

// ── Format Currency ──
function formatPrice(num) {
  if (num == null || isNaN(num) || num <= 0) return null
  return priceFormatter.format(Number(num))
}

// ── Kategori İkon Haritası (Waypoint Orijinal Renkleri) ──
function getCategoryIcon(name, active) {
  const color = active ? '#5be7c4' : '#e8dac2'
  const size = 22
  const strokeWidth = 1.8
  const n = (name || '').toLowerCase()

  if (n.includes('tümü')) return <Sparkles size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('sıcak')) return <Coffee size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('kahve') && n.includes('soğuk')) return <Snowflake size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('kahve')) return <Coffee size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('soğuk')) return <GlassWater size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('meyve')) return <Citrus size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('frozen') || n.includes('refresher')) return <Snowflake size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('milkshake')) return <Milk size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('smoothie')) return <Apple size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('yiyecek')) return <UtensilsCrossed size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('tatlı')) return <CakeSlice size={size} color={color} strokeWidth={strokeWidth} />
  if (n.includes('nargile')) return <Flame size={size} color={color} strokeWidth={strokeWidth} />

  return <Sparkles size={size} color={color} strokeWidth={strokeWidth} />
}

// ── Otomatik Ürün Grubu Kuralları ──
const GROUP_RULES = [
  {
    id: 'grp-oralet',
    name: 'Oralet',
    description: 'Çilek, muz, karadut, kivi, portakal, limon ve kuşburnu seçenekleri.',
    coverImage: getAssetUrl('images/oralet.jpg'),
    match: (item) => trLower(item.name).includes('oralet'),
  },
  {
    id: 'grp-frozen',
    name: 'Frozen',
    description: 'Buz gibi, meyveli Frozen çeşitleri.',
    coverImage: getAssetUrl('images/frozen.jpg'),
    match: (item) => trLower(item.name).includes('frozen'),
  },
  {
    id: 'grp-soda',
    coverImage: getAssetUrl('images/soda.jpg'),
    name: 'Soda Çeşitleri',
    description: 'Sade, Limonlu, Karpuz-Çilek, Karadut, Kiwili, Elmalı, Narlı ve diğer aromalar',
    match: (item) => trLower(item.name).includes('soda'),
  },
  {
    id: 'grp-kola',
    name: 'Kola',
    description: 'Cam şişe ve kutu teneke alternatifleriyle serinletici lezzet',
    coverImage: getAssetUrl('images/cocacola.jpg'),
    match: (item) => {
      const n = trLower(item.name)
      return (n.includes('şişe kola') || n.includes('teneke kola') || n.includes('cam kola') || n === 'kola') && !n.includes('çikolata')
    },
  },
  {
    id: 'grp-tost',
    coverImage: getAssetUrl('images/kasarli-tost.jpg'),
    name: 'Tost Çeşitleri',
    description: 'Taze kaşarlı ve karışık zengin seçenekler',
    match: (item) => trLower(item.name).includes('tost'),
  },
  {
    id: 'grp-kofte',
    coverImage: getAssetUrl('images/kofte.jpg'),
    name: 'Köfte Seçenekleri',
    description: 'Ekmek arası ve porsiyon seçenekleri',
    match: (item) => {
      const n = trLower(item.name)
      return n === 'köfte' || n === 'köfte porsiyon'
    },
  },
  {
    id: 'grp-milkshake',
    coverImage: getAssetUrl('images/milkshake.jpg'),
    name: 'Milkshake Çeşitleri',
    description: 'Çikolata, Çilek ve Vanilya seçenekleriyle',
    match: (item) => trLower(item.name).includes('milkshake'),
  },
  {
    id: 'grp-smoothie',
    coverImage: getAssetUrl('images/smoothie.jpg'),
    name: 'Smoothie Çeşitleri',
    description: 'Frambuaz, Orman Meyveli ve Yaban Mersinli taze püreler',
    match: (item) => trLower(item.name).includes('smoothie'),
  },
  {
    id: 'grp-bitki-cayi',
    coverImage: getAssetUrl('images/bitki-cayi.jpg'),
    name: 'Bitki Çayları',
    description: 'Ihlamur, Papatya, Kuşburnu, Böğürtlen ve Nane-Limon',
    match: (item) => {
      const n = trLower(item.name)
      return ['böğürtlen çayı', 'kuşburnu çayı', 'ıhlamur', 'papatya', 'nane-limon'].some(k => n.includes(k))
    },
  },
  {
    id: 'grp-turk-kahvesi',
    coverImage: getAssetUrl('images/turk-kahvesi.jpg'),
    name: 'Geleneksel Türk Kahvesi',
    description: 'Klasik, Damla Sakızlı, Dibek ve Osmanlı kahvesi',
    match: (item) => {
      const n = trLower(item.name)
      if (/menen?gi[çc]/.test(n)) return false
      return ['türk kahvesi', 'damla sakızlı', 'dibek', 'osmanlı kahvesi'].some(k => n.includes(k))
    },
  },
  {
    id: 'grp-sicak-cikolata',
    coverImage: getAssetUrl('images/sicak-cikolata.jpg'),
    name: 'Sıcak Çikolata Çeşitleri',
    description: 'Klasik ve marshmallowlu sıcacık lezzet',
    match: (item) => trLower(item.name).includes('sıcak çikolata'),
  },
]

// ── Katalog Gruplama Fonksiyonu ──
function groupCatalog(allItems) {
  const matchedItemIds = new Set()
  const result = []

  for (const rule of GROUP_RULES) {
    const matching = allItems.filter(it => !matchedItemIds.has(it.id) && rule.match(it))
    if (matching.length > 1) {
      matching.forEach(it => matchedItemIds.add(it.id))

      // Sade / Klasik seçeneği en başa alma
      matching.sort((a, b) => {
        const aName = trLower(a.name)
        const bName = trLower(b.name)
        const aIsBase = aName.startsWith('sade') || aName === 'türk kahvesi' || aName.includes('şişe') || aName.includes('cam')
        const bIsBase = bName.startsWith('sade') || bName === 'türk kahvesi' || bName.includes('şişe') || bName.includes('cam')
        if (aIsBase && !bIsBase) return -1
        if (!aIsBase && bIsBase) return 1
        return aName.localeCompare(bName, 'tr-TR')
      })

      const validPrices = matching
        .map(v => Number(v.price))
        .filter(p => !isNaN(p) && p > 0)
      const minPrice = validPrices.length ? Math.min(...validPrices) : null
      const maxPrice = validPrices.length ? Math.max(...validPrices) : null
      const isAvailable = matching.some(v => v.is_available !== false)
      const firstImage = matching.find(v => /^https?:\/\//.test(v.image_url || ''))?.image_url || rule.coverImage || matching.find(v => Boolean(v.image_url))?.image_url || null

      result.push({
        isGroup: true,
        id: rule.id,
        name: rule.name,
        description: rule.description,
        category_id: matching[0].category_id,
        categories: matching[0].categories,
        image_url: firstImage,
        variants: matching,
        minPrice,
        maxPrice,
        is_available: isAvailable,
      })
    }
  }

  for (const item of allItems) {
    if (!matchedItemIds.has(item.id)) {
      result.push(item)
    }
  }

  return result
}

export default function MenuPage() {
  const [promotionId, setPromotionId] = useState(null)
  const [promotionDismissed, setPromotionDismissed] = useState(false)
  const closePromotion = useCallback(() => setPromotionDismissed(true), [])
  useEffect(() => {
    let active = true
    supabase.from('menu_promotion').select('product_id, enabled').eq('id', 1).maybeSingle().then(({ data }) => {
      if (active && data?.enabled) setPromotionId(data.product_id)
    })
    return () => { active = false }
  }, [])
  const [showHero, setShowHero]           = useState(true)
  const [cached] = useState(() => readMenuCache(CACHE_KEY))
  const [categories, setCategories]       = useState(() => (cached?.categories || []).filter(cat => trLower(cat.name).trim() !== 'taze meyve suları'))
  const [items, setItems]                 = useState(cached?.items || [])
  const [selectedCategoryId, setActiveId] = useState(null)
  const activeId = selectedCategoryId || categories.find(cat => !['smoothie', 'milkshake'].includes(trLower(cat.name).trim()))?.id || null
  const [search, setSearch]               = useState('')
  const [loading, setLoading]             = useState(!cached)
  const [error, setError]                 = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [cacheNotice, setCacheNotice] = useState(cached ? 'Kaydedilen menü gösteriliyor; güncel fiyatlar kontrol ediliyor…' : '')
  const closeProduct = useCallback(() => setSelectedProduct(null), [])
  const deferredSearch = useDeferredValue(search)
  const headerRef                         = useRef(null)

  useEffect(() => {
    if (!loading && !error) {
      const target = showHero ? document.querySelector('.hero-cta-btn') : headerRef.current?.querySelector('input')
      target?.focus({ preventScroll: true })
    }
  }, [showHero, loading, error])

  // ── Auto-hide header on scroll down, reveal on scroll up ──
  useEffect(() => {
    let lastY = window.scrollY
    let isHidden = false

    function handleScroll() {
      const currentY = window.scrollY
      const delta = currentY - lastY
      const headerEl = headerRef.current
      if (!headerEl) return

      if (currentY <= 60) {
        if (isHidden) {
          headerEl.classList.remove('header-hidden')
          isHidden = false
        }
      } else if (delta > 8 && !isHidden) {
        headerEl.classList.add('header-hidden')
        isHidden = true
      } else if (delta < -8 && isHidden) {
        headerEl.classList.remove('header-hidden')
        isHidden = false
      }

      lastY = currentY
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // ── Drag-to-scroll for stories bar ──
  const barRef = useRef(null)
  const drag   = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false })

  function onMouseDown(e) {
    const el = barRef.current
    drag.current = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, moved: false }
  }
  function onMouseMove(e) {
    if (!drag.current.active) return
    e.preventDefault()
    const el   = barRef.current
    const walk = (e.pageX - el.offsetLeft - drag.current.startX) * 1.2
    if (Math.abs(walk) > 4) drag.current.moved = true
    el.scrollLeft = drag.current.scrollLeft - walk
  }
  function onMouseUp()    { drag.current.active = false }
  function onMouseLeave() { drag.current.active = false }

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = setTimeout(() => controller.abort(), 12000)
    async function load() {
      try {
        const [catsRes, itsRes] = await Promise.all([
          supabase.from('categories').select('*').order('sort_order').abortSignal(controller.signal),
          supabase.from('menu_items').select('*, categories(name)').order('created_at').abortSignal(controller.signal),
        ])
        if (catsRes.error) throw catsRes.error
        if (itsRes.error)  throw itsRes.error
        if (!active) return
        setError(null)
        setCacheNotice('')
        setCategories((catsRes.data || []).filter(cat => trLower(cat.name).trim() !== 'taze meyve suları'))
        const rawItems = itsRes.data || []
        const mappedItems = rawItems.map(it => {
          const img = getItemImage(it)
          const desc = getItemDescription(it)
          return {
            ...it,
            image_url: img || null,
            description: it.description || desc || null,
          }
        })
        setItems(mappedItems)
        writeMenuCache(CACHE_KEY, catsRes.data || [], mappedItems)
      } catch {
        if (!active) return
        if (readMenuCache(CACHE_KEY)) setCacheNotice('Bağlantı kurulamadı. Kaydedilen menü gösteriliyor; fiyat ve stok bilgisini servis personeline doğrulatın.')
        else setError('Menüye şu anda ulaşılamıyor.')
      } finally {
        clearTimeout(timeout)
        if (active) setLoading(false)
      }
    }
    load()
    const reconnect = () => setRefreshKey(key => key + 1)
    window.addEventListener('online', reconnect)
    return () => { active = false; clearTimeout(timeout); controller.abort(); window.removeEventListener('online', reconnect) }
  }, [refreshKey, cached])

  // Gruplanmış genel menü listesi
  const groupedCatalog = useMemo(() => {
    const hotCategory = categories.find(cat => trLower(cat.name) === 'sıcak içecekler')
    const refresherCategory = categories.find(cat => /refresher|frozen/.test(trLower(cat.name)))
    const catalogItems = items.map(item => refresherCategory && /smoothie|milkshake/.test(trLower(item.name))
      ? { ...item, category_id: refresherCategory.id, categories: { name: refresherCategory.name } }
      : item)
    if (hotCategory && !items.some(item => trLower(item.name).includes('oralet'))) {
      for (const [index, flavor] of ['Çilek', 'Muz', 'Karadut', 'Kivi', 'Portakal', 'Limon', 'Kuşburnu'].entries()) {
        catalogItems.push({
          id: `oralet-${index}`,
          name: `${flavor} Oralet`,
          category_id: hotCategory.id,
          categories: { name: hotCategory.name },
          price: 40,
          is_available: true,
        })
      }
    }
    return groupCatalog(catalogItems)
  }, [items, categories])

  // Arama tüm menüyü kapsar; kategori yalnızca arama boşken uygulanır.
  const filtered = useMemo(() => {
    let list = groupedCatalog
    if (!deferredSearch.trim() && activeId !== 'all') {
      list = list.filter(i => i.category_id === activeId)
    }
    if (deferredSearch.trim()) {
      const q = trLower(deferredSearch.trim())
      list = list.filter(i => {
        if (i.isGroup) {
          if (trLower(i.name).includes(q) || trLower(i.description).includes(q)) return true
          return i.variants.some(v =>
            trLower(v.name).includes(q) || trLower(v.description || '').includes(q)
          )
        }
        return trLower(i.name).includes(q) || trLower(i.description || '').includes(q)
      })
    }
    return list
  }, [groupedCatalog, activeId, deferredSearch])

  const activeName = activeId === 'all'
    ? 'Tümü'
    : (categories.find(c => c.id === activeId)?.name || '')

  if (loading) return (
    <div className="container">
      <div className="loading-screen">
        <div className="spinner" />
        <span>Menü hazırlanıyor…</span>
      </div>
    </div>
  )

  if (error) return (
    <div className="container">
      <div className="loading-screen" style={{ textAlign: 'center', padding: '40px 24px' }}>
        <h3 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: '1.1rem' }}>Menü Yüklenemedi</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 16, maxWidth: 280 }}>
          Sunucuyla bağlantı kurulamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.
        </p>
        <code style={{
          background: 'rgba(255,107,53,0.1)',
          border: '1px solid rgba(255,107,53,0.3)',
          borderRadius: 8,
          padding: '10px 16px',
          fontSize: '0.75rem',
          color: '#ff6b35',
          display: 'block',
          maxWidth: 320,
          wordBreak: 'break-all',
        }}>{error}</code>
        <button className="btn btn-primary" type="button" onClick={() => { setError(null); setLoading(true); setRefreshKey(key => key + 1) }}>Tekrar dene</button>
      </div>
    </div>
  )

  return (
    <div className="menu-root-wrap">
      {/* ── 1. ULTRA LUXURY OPENING HERO SCREEN (Waypoint Dark Palette) ── */}
      {showHero && (
        <OpeningHeroScreen onEnter={() => setShowHero(false)} />
      )}

      {/* ── 2. MENU SHOWCASE & CONTENT ── */}
      <div className={`container ${showHero ? 'menu-content-hidden' : ''}`} inert={showHero ? true : undefined}>
        {/* ── Header (Waypoint Signature Coffee & Emerald Teal) ── */}
        <header ref={headerRef} className="menu-header">
          <div className="menu-header-top">
            <div
              className="menu-logo ipek-pressable"
              onClick={() => setShowHero(true)}
              role="button"
              tabIndex={0}
              title="Karşılama ekranına dön"
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowHero(true) } }}
            >
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt="Waypoint Logo"
                className="menu-logo-img"
              />
              <div className="menu-logo-text">
                <span className="menu-logo-name">WAYPOINT</span>
                <span className="menu-logo-sub">COFFEE & HOOKAH</span>
              </div>
            </div>
          </div>

          <div className="menu-search-wrap">
            <Search size={16} className="menu-search-icon" />
            <input
              className="menu-search"
              type="search"
              aria-label="Menüde ürün ara"
              placeholder="Menüde ara (Kahve, nargile, kola, tatlı…)"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="menu-search-clear"
                onClick={() => setSearch('')}
                aria-label="Aramayı temizle"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </header>

        {cacheNotice && <div className="cache-notice" role="status">{cacheNotice} <button type="button" onClick={() => setRefreshKey(key => key + 1)}>Yenile</button></div>}
        {/* ── Categories Bar (Story Bubbles) ── */}
        <div
          className="stories-bar"
          ref={barRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        >
          <div className="stories-track" role="group" aria-label="Menü kategorileri">
            {categories.filter(cat => !['smoothie', 'milkshake'].includes(trLower(cat.name).trim())).map(cat => {
              const isActive = activeId === cat.id
              return (
                <button type="button" aria-pressed={isActive}
                  key={cat.id}
                  className={`story-item${isActive ? ' active' : ''}`}
                  onClick={() => { if (!drag.current.moved) setActiveId(cat.id) }}
                >
                  <div className={`story-ring${isActive ? ' active' : ''}`}>
                    <div className="story-img-wrap">
                      {cat.image_url ? (
                        <img src={cat.image_url} alt={cat.name} />
                      ) : (
                        getCategoryIcon(cat.name, isActive)
                      )}
                    </div>
                  </div>
                  <span className="story-label">{cat.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Category Title Bar ── */}
        {!search && (
          <div className="category-title-bar">
            <h2 className="category-title">{activeName}</h2>
            <span className="category-count">{filtered.length} Çeşit</span>
          </div>
        )}

        {/* ── Product Feed / Vitrin (Editorial Cards) ── */}
        <p className="sr-only" role="status">{filtered.length} ürün grubu bulundu.</p>
        <main className="menu-feed">
          {filtered.length === 0 ? (
            <div className="no-results fade-in">
              <UtensilsCrossed size={36} strokeWidth={1.5} color="var(--text-muted)" />
              <h3>Sonuç bulunamadı</h3>
              <p>{search ? 'Farklı bir arama terimi deneyin.' : 'Bu kategoride henüz ürün bulunmuyor.'}</p>
            </div>
          ) : (
            filtered.map((item, i) => (
              <EditorialProductCard
                key={item.id}
                item={item}
                delay={Math.min(i, 12) * 15}
                onSelect={setSelectedProduct}
              />
            ))
          )}
        </main>

        {/* ── Footer ── */}
        <footer className="menu-footer">
          <p>© <span>Mehmet Ali ERDOĞAN</span></p>
        </footer>
      </div>

      {/* ── 3. PRODUCT SHOWCASE / VITRIN MODAL (Direct child of root to avoid stacking context issues) ── */}
      {!showHero && !promotionDismissed && !selectedProduct && items.some(item => item.id === promotionId && item.is_available !== false) && (
        <WelcomePromotion product={items.find(item => item.id === promotionId)} onClose={closePromotion} onOpen={product => {
          closePromotion()
          setShowHero(false)
          setSearch('')
          setActiveId(/smoothie|milkshake/.test(trLower(product.name)) ? categories.find(cat => /refresher|frozen/.test(trLower(cat.name)))?.id || product.category_id : product.category_id)
          setSelectedProduct(product)
        }} />
      )}
      {selectedProduct && (
        <ProductVitrinModal
          product={selectedProduct}
          onClose={closeProduct}
        />
      )}
    </div>
  )
}

// ── 1. ULTRA LUXURY OPENING HERO SCREEN (Waypoint Dark Palette) ──
function OpeningHeroScreen({ onEnter }) {
  const [socialLinks, setSocialLinks] = useState({ instagram: INSTAGRAM_URL, whatsapp: WHATSAPP_URL })
  useEffect(() => {
    let active = true
    supabase.from('social_settings').select('instagram_url, whatsapp_number').eq('id', 1).maybeSingle().then(({ data }) => {
      if (!active || !data) return
      try {
        const number = normalizeWhatsApp(data.whatsapp_number)
        setSocialLinks({ instagram: normalizeInstagram(data.instagram_url), whatsapp: number ? `https://wa.me/${number}` : '' })
      } catch { /* Keep existing links if stored settings are invalid. */ }
    })
    return () => { active = false }
  }, [])
  const touchStartY = useRef(null)

  const handleWheel = (e) => {
    if (e.deltaY > 24) {
      onEnter()
    }
  }

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches?.[0]?.clientY ?? null
  }

  const handleTouchEnd = (e) => {
    const start = touchStartY.current
    const end = e.changedTouches?.[0]?.clientY
    touchStartY.current = null
    if (typeof start === 'number' && typeof end === 'number' && start - end > 40) {
      onEnter()
    }
  }

  return (
    <div
      className="hero-viewport snap-section ipek-page-enter"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="hero-bg-layer" />
      <div className="cinematic-overlay" />

      <div className="hero-shell ipek-soft-enter">
        {/* Floating Emblem Logo */}
        <div className="hero-logo-wrap">
          <span className="hero-logo-medallion">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Waypoint Logo"
            className="ipek-logo-enter hero-logo-img"
          />
          </span>
        </div>

        {/* Tagline Divider */}
        <div className="hero-tagline-row">
          <div className="hero-divider-line left" />
          <span className="hero-tagline-text">COFFEE & HOOKAH</span>
          <div className="hero-divider-line right" />
        </div>

        {/* Big Serif Heading */}
        <h1 className="hero-brand-title">WAYPOINT</h1>

        {/* Subtitle */}
        <p className="hero-brand-subtitle">QR MENÜ</p>

        {/* Lounge Details */}
        <div className="hero-brand-desc">
          <p>Özel Kahveler • Zengin Tatlar • Premium Nargile Seçkisi</p>
        </div>

        {/* Pulsing Emerald CTA Button */}
        <button
          type="button"
          onClick={onEnter}
          className="hero-cta-btn ipek-pressable pulse-teal"
        >
          MENÜYÜ KEŞFET
        </button>

        <div className="hero-social-links" aria-label="Sosyal medya ve iletişim">
          {[{ label: 'Instagram', icon: 'instagram.svg', url: socialLinks.instagram }, { label: 'WhatsApp', icon: 'whatsapp.svg?v=2', url: socialLinks.whatsapp }].filter(social => social.url).map(social => social.url ? (
            <a key={social.label} className="hero-social-button" href={social.url} target="_blank" rel="noopener noreferrer">
              <img src={`${import.meta.env.BASE_URL}${social.icon}`} alt="" width="24" height="24" />{social.label}
            </a>
          ) : (
            <button key={social.label} className="hero-social-button" type="button" disabled title="Bağlantı hazırlanıyor">
              <img src={`${import.meta.env.BASE_URL}${social.icon}`} alt="" width="24" height="24" />{social.label}
            </button>
          ))}
        </div>

        {/* Scroll Cue */}
        <div
          className="hero-scroll-cue-box"
          onClick={onEnter}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onEnter() }}
        >
          <span className="hero-scroll-cue-text">KAYDIR</span>
          <span className="hero-scroll-cue-arrow ipek-scroll-cue">↓</span>
        </div>
      </div>
    </div>
  )
}

// ── 2. EDITORIAL PRODUCT CARD (Dark Luxury Vitrin Tasarımı) ──
const EditorialProductCard = memo(function EditorialProductCard({ item, delay, onSelect }) {
  const isAvail = item.is_available !== false
  const imgUrl = getItemImage(item)
  const hasImage = Boolean(imgUrl)
  const displayName = item.name === 'Şişe Kola' ? 'Cam Şişe Kola' : item.name

  let priceText = null
  if (item.isGroup) {
    if (item.minPrice != null) {
      if (item.minPrice === item.maxPrice) {
        priceText = formatPrice(item.minPrice)
      } else {
        priceText = `${formatPrice(item.minPrice)}’den başlayan fiyatlarla`
      }
    }
  } else {
    priceText = formatPrice(item.price)
  }

  const categoryName = item.categories?.name || 'Waypoint Seçkisi'
  const desc = item.description || getItemDescription(item)

  return (
    <article
      className={`editorial-card group ${isAvail ? 'ipek-pressable' : 'editorial-card-out'}`}
      style={{ animationDelay: `${delay}ms` }}
      onClick={() => onSelect(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item) }
      }}
    >
      <div className="editorial-card-inner">
        {/* Left: Product Image Box */}
        <div className="editorial-card-img-wrap">
          <div className="ipek-card-image">
            {hasImage ? (
              <img
                src={imgUrl}
                alt={displayName}
                className={`editorial-card-img ${/^çay$|^cay$|limonata|ayran|[şs]algam|uluda[ğg].*gazoz|yedi\s*g[üu]n|frozen|smoothie|milkshake|cool lime|berry hib[ui]scus/.test(trLower(item.name)) ? 'editorial-card-img-frozen' : ''} ${!isAvail ? 'grayscale opacity-60' : ''}`}
                loading="lazy" decoding="async"
              />
            ) : (
              <div className="editorial-card-placeholder">
                {getCategoryIcon(categoryName, true)}
              </div>
            )}
          </div>

          {!isAvail && (
            <div className="editorial-card-out-tag">
              <span>Tükendi</span>
            </div>
          )}

          {item.isGroup && isAvail && (
            <div className="editorial-card-group-pill">
              <Layers size={10} strokeWidth={2.4} />
              <span>{item.variants.length}</span>
            </div>
          )}
        </div>

        {/* Right: Info and Pricing */}
        <div className="editorial-card-body">
          <div className="editorial-card-header-row">
            <span className="editorial-card-eyebrow">{categoryName}</span>
            {item.isGroup && (
              <span className="editorial-variant-count-badge">
                <Layers size={10} strokeWidth={2.2} />
                {item.variants.length} Seçenek
              </span>
            )}
          </div>

          <h3 className="editorial-card-title">{displayName}</h3>

          {desc && <p className="editorial-card-desc">{desc}</p>}

          <div className="editorial-card-footer-row">
            <span className="editorial-card-price">
              {isAvail ? (priceText || 'Fiyat sorunuz') : 'Tükendi'}
            </span>
            <span className="editorial-card-action-circle" aria-hidden="true">
              <ArrowUpRight size={16} strokeWidth={2.4} />
            </span>
          </div>
        </div>
      </div>
    </article>
  )
})

// ── 3. PRODUCT SHOWCASE / VITRIN BOTTOM SHEET MODAL (Dark Luxury) ──
function ProductVitrinModal({ product, onClose }) {
  const dialogRef = useDialog(onClose)

  const imgUrl = getItemImage(product)
  const isFrozen = product.id === 'grp-frozen' || trLower(product.name).includes('frozen')
  const hasImage = Boolean(imgUrl)
  const categoryName = product.categories?.name || 'Waypoint Seçkisi'
  const isGroup = Boolean(product.isGroup && product.variants?.length > 1)

  return (
    <div className="ipek-modal-backdrop-enter modal-backdrop" onClick={onClose}>
      <div
        className="ipek-modal-sheet-enter modal-sheet"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
      >
        {/* Top Handle */}
        <div className="sheet-handle-wrap">
          <div className="sheet-handle" />
        </div>

        {/* Hero Image Showcase */}
        {hasImage ? (
          <div className={`modal-hero-img-wrap${isFrozen || /^çay$|^cay$|limonata|ayran|[şs]algam|uluda[ğg].*gazoz|yedi\s*g[üu]n|smoothie|milkshake|cool lime|berry hib[ui]scus/.test(trLower(product.name)) ? ' modal-hero-frozen' : ''}`}>
            <img src={imgUrl} alt={product.name} className="modal-hero-img" />
            <div className="modal-hero-badge-row">
              <span className="modal-hero-cat-tag">{categoryName}</span>
              {isGroup && (
                <span className="modal-hero-variant-tag">
                  <Layers size={11} strokeWidth={2.2} />
                  {product.variants.length} Seçenek
                </span>
              )}
            </div>
            <button
              type="button"
              className="modal-close-round-btn ipek-pressable"
              onClick={onClose}
              aria-label="Kapat"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <div className="modal-no-img-header">
            <span className="modal-hero-cat-tag">{categoryName}</span>
            <button
              type="button"
              className="modal-close-round-btn ipek-pressable"
              onClick={onClose}
              aria-label="Kapat"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="modal-sheet-content">
          <div className="modal-sheet-title-row">
            <h2 id="product-modal-title" className="modal-sheet-title">{product.name}</h2>
          </div>

          {product.description && (
            <p className="modal-sheet-desc">{product.description}</p>
          )}

          {/* If Product has Variants (e.g. Kola -> Cam Şişe & Teneke) */}
          {isGroup && (
            <div className="modal-variants-block">
              <div className="modal-variants-block-title">
                <Layers size={13} strokeWidth={2.2} />
                <span>Çeşitler & Alternatifler</span>
              </div>

              <div className="modal-variants-list">
                {product.variants.map((v) => {
                  const isAvail = v.is_available !== false
                  const p = Number(v.price)
                  const hasPrice = !isNaN(p) && p > 0
                  const vDisplayName = v.name === 'Şişe Kola' ? 'Cam Şişe Kola' : v.name
                  const vDesc = v.description || getItemDescription(v)

                  return (
                    <div
                      key={v.id}
                      className={`modal-variant-row${!isAvail ? ' modal-variant-unavailable' : ''}`}
                    >
                      <div className="modal-variant-left">
                        <div className="modal-variant-info">
                          <span className="modal-variant-name">{vDisplayName}</span>
                          {vDesc && <span className="modal-variant-subdesc">{vDesc}</span>}
                          {!isAvail && <span className="modal-variant-out-tag">Tükendi</span>}
                        </div>
                      </div>

                      {hasPrice && (
                        <div className="modal-variant-price-wrap">
                          <span className="modal-variant-price">{formatPrice(p)}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Footer Note */}
          <div className="modal-sheet-footer-note">
            <span>Siparişinizi servis personelimize iletebilirsiniz.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

