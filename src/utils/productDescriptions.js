// General menu descriptions, not supplier ingredient or allergen declarations.
// Keep descriptions entered by the owner ahead of these defaults.
const descriptions = {
  'çay': 'Demlenmiş siyah çay.',
  'sıcak çikolata': 'Çikolata aromalı sıcak içecek; yoğun ve tatlı bir seçenek.',
  'marshmallowlu sıcak çikolata': 'Sıcak çikolata ve üzerinde marshmallow parçaları.',
  'salep': 'Kıvamlı, sıcak salep içeceği.',
  'ıhlamur': 'Ihlamur aromasıyla hazırlanan sıcak bitki çayı.',
  'papatya': 'Papatya aromalı sıcak bitki çayı.',
  'nane limon': 'Nane ve limon aromalarını bir araya getiren sıcak içecek.',
  'böğürtlen çayı': 'Böğürtlen aromalı sıcak meyve çayı.',
  'kuşburnu çayı': 'Kuşburnunun hafif ekşi aromasıyla sıcak meyve çayı.',
  'türk kahvesi': 'İnce öğütülmüş kahveyle hazırlanan, telvesiyle sunulan geleneksel Türk kahvesi.',
  'damla sakızlı türk kahvesi': 'Türk kahvesine eşlik eden damla sakızı aroması.',
  'osmanlı kahvesi': 'Farklı aromaların bir araya geldiği geleneksel kahve harmanı.',
  'dibek': 'Dibek usulü kahve harmanı; yumuşak aromalı bir seçenek.',
  'menengiç': 'Menengiç meyvesinin kavruk ve kendine özgü aromasıyla hazırlanan sıcak içecek.',
  'nescafe gold': 'Sıcak suyla hazırlanan çözünebilir kahve.',
  'espresso': 'Az miktarda suyla basınç altında hazırlanan, yoğun aromalı kahve.',
  'americano': 'Espressoya sıcak su eklenerek hazırlanan sade kahve.',
  'latte': 'Espresso ve sıcak sütün ince süt köpüğüyle buluşması.',
  'karamel latte': 'Espresso, sıcak süt ve karamel aroması.',
  'vanilya latte': 'Espresso, sıcak süt ve vanilya aroması.',
  'mocha': 'Espresso, süt ve çikolata lezzetini bir araya getiren sıcak kahve.',
  'white chocolate mocha': 'Espresso ve sütün beyaz çikolata aromasıyla birleşimi.',
  'ice americano': 'Espresso ve suyla hazırlanan, buzla sunulan sade kahve.',
  'ice latte': 'Espresso ve soğuk sütün buzla sunulan birleşimi.',
  'ice karamel latte': 'Espresso, soğuk süt ve karamel aroması; buzla servis edilir.',
  'ice vanilya latte': 'Espresso, soğuk süt ve vanilya aroması; buzla servis edilir.',
  'ice mocha': 'Espresso, soğuk süt ve çikolata aroması; buzla servis edilir.',
  'ice white chocolate mocha': 'Espresso, soğuk süt ve beyaz çikolata aroması; buzla servis edilir.',
  'ayran': 'Yoğurt bazlı, soğuk servis edilen geleneksel içecek.',
  'şalgam': 'Kendine özgü ekşi aromasıyla geleneksel fermente şalgam içeceği.',
  'limonata': 'Limonun ekşi ve tatlı notalarını bir araya getiren soğuk içecek.',
  'yedigün': 'Portakal aromalı gazlı içecek.',
  'uludağ gazoz': 'Klasik gazoz aromasıyla gazlı içecek.',
  'burn': 'Soğuk servis edilen enerji içeceği.',
  'redbull': 'Soğuk servis edilen enerji içeceği.',
  'sade soda': 'Sade, gazlı maden suyu.',
  'cool lime': 'Yeşil limon aromalı soğuk içecek.',
  'berry hibiscus': 'Hibiskus ve meyve aromalarını buluşturan soğuk içecek.',
  'köfte': 'Ekmek arası köfte. Klasikten vazgeçmeyenlere.',
  'köfte porsiyon': 'Tabakta servis ettiğimiz köfte porsiyonu. Oturup yemeğin tadını çıkarmalık.',
  'patates porsiyon': 'Sıcak patates kızartması. Ortaya söylemelik, paylaşmalık.',
  'kumru': 'Kumru ekmeğiyle hazırladığımız sıcak sandviç. Acıktığında iyi gider.',
  'hamburger': 'Yumuşak ekmek arasında hamburger köftesi. Acıktığında doyurucu bir seçenek.',
  'döner': 'Ekmek arası döner. Öğle arasında da akşam acıkınca da.',
  'patso': 'Ekmek arası patates kızartması. Bildiğin, sevdiğin patso.',
  'kaşarlı tost': 'Arasında eriyen kaşarıyla sıcacık tost. Çayın yanına da yakışır.',
  'karışık tost': 'Tostunu karışık sevenlere. Sıcak sıcak, günün her saatinde.',
  'san sebastian cheesecake': 'Koyu renkli pişmiş üst yüzeyi ve yumuşak dokusuyla San Sebastian usulü cheesecake.',
  'sufle': 'Çikolatalı, yumuşak dokulu sıcak tatlı.',
  'mono latte': 'Latte aromalı, tek kişilik pasta.',
  'incirli cevizli mono': 'İncir ve ceviz lezzetlerini bir araya getiren tek kişilik pasta.',
  'çikolata frambuaz mono': 'Çikolatanın yoğun tadıyla frambuazın hafif ekşiliğini buluşturan tek kişilik pasta.',
  'lotus cup': 'Lotus bisküvisi aromasıyla hazırlanan kupta tatlı.',
  'orman meyveli cup': 'Orman meyvelerinin tatlı ve ekşi notalarıyla kupta tatlı.',
  'tiramisu': 'Kahve ve kakao aromalarıyla katmanlı, kremalı tatlı.',
  'waffle': 'Waffle hamuru üzerinde tatlı bir sunum. Güncel sos ve eşlikçi seçeneklerini servis personelinden öğrenebilirsiniz.',
  'cedric mango': 'Mango aromalı, tek kişilik Cedric tatlısı.',
  'cedric kahveli': 'Kahve aromalı, tek kişilik Cedric tatlısı.',
  'cedric antep fıstıklı': 'Antep fıstığı aromalı, tek kişilik Cedric tatlısı.',
  'oralet': 'Meyve aromalı sıcak içecek.',
}

function normalize(value) {
  return (value || '').toLocaleLowerCase('tr-TR').normalize('NFC')
    .replace(/nescaf[ée]/g, 'nescafe')
    .replace(/^ıce(d)?\s+/, 'ice ')
    .replace(/^iced\s+/, 'ice ')
    .replace(/vanilyalı/g, 'vanilya')
    .replace(/esprosso/g, 'espresso')
    .replace(/suffle/g, 'sufle')
    .replace(/meneng[iı]c|menengiç/g, 'menengiç')
    .replace(/cedric kahve$/, 'cedric kahveli')
    .replace(/\s*[&–-]\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

export function defaultProductDescription(item) {
  const category = normalize(item?.categories?.name || item?.category_name)
  if (category.includes('nargile')) return null
  const name = normalize(item?.name)
  if (descriptions[name]) return descriptions[name]
  if (/nescafe.*3.*1/.test(name)) return 'Kahve, kahve beyazlatıcısı ve şeker içeren hazır kahve karışımı.'
  if (/^(teneke|kutu|şişe|cam|cam şişe) kola$|^(kola|coca cola|cococola)$/.test(name)) return 'Kola aromalı gazlı içecek; soğuk servis edilir.'
  if (/soda$/.test(name)) {
    const aroma = name.replace(/\s+soda$/, '')
    return `${aroma.charAt(0).toLocaleUpperCase('tr-TR') + aroma.slice(1)} aromalı gazlı içecek.`
  }
  if (name.includes('frozen')) return `${item.name}: meyve aroması ve buzla hazırlanan, yoğun buzlu dokulu soğuk içecek.`
  if (name.includes('milkshake')) return `${item.name}: sütlü, kıvamlı ve soğuk içecek.`
  if (name.includes('smoothie')) return `${item.name}: meyve aromasıyla hazırlanan, kıvamlı soğuk içecek.`
  if (category.includes('meyve suları')) return 'Seçtiğiniz meyvenin aromasıyla soğuk içecek.'
  return null
}
