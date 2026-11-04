// Bir staging yedeğinden (npm run backup:staging) Supabase SQL Editor'da çalıştırılacak geri yükleme SQL'i üretir:
//   node scripts/staging-restore-sql.mjs <yedek-klasörü>  →  <yedek-klasörü>/restore.sql
// Hiçbir veritabanına bağlanmaz. Üretilen dosya, listelenen public tabloları TEK işlemde boşaltıp yedekteki satırlarla
// doldurur (tetikleyiciler ve FK denetimleri bu oturumda kapalı: session_replication_role = replica). Önce manifest
// özetleri doğrulanır; bozuk/eksik yedekten SQL üretilmez.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Ebeveynler önce; boşaltma tek TRUNCATE ile yapılır.
const ORDER = ['categories', 'menu_items', 'menu_promotion', 'social_settings', 'restaurant_tables', 'table_qr_tokens', 'staff_profiles',
  'fulfillment_settings', 'delivery_zones', 'table_sessions', 'bills', 'orders', 'order_items', 'order_fulfillments',
  'order_status_history', 'payments', 'audit_log']

const dir = process.argv[2] && resolve(process.argv[2])
if (!dir) { console.error('Kullanım: node scripts/staging-restore-sql.mjs <yedek-klasörü>'); process.exit(2) }
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
if (manifest.project_ref !== 'jnnjijmdzcjglclcnwtm') { console.error('✖ Yedek staging projesine ait değil.'); process.exit(2) }

const tables = ORDER.filter(table => manifest.tables[table] && !manifest.tables[table].error)
const missing = ORDER.filter(table => !tables.includes(table))
if (missing.length) { console.error(`✖ Yedekte eksik tablo: ${missing.join(', ')}`); process.exit(1) }

const dollar = text => { let tag = 'r'; while (text.includes(`$${tag}$`)) tag += 'x'; return `$${tag}$${text}$${tag}$` }
const parts = ['-- Waypoint staging geri yükleme (yalnızca staging: jnnjijmdzcjglclcnwtm)',
  `-- Yedek: ${manifest.created_at}  commit: ${manifest.repo_commit ?? '-'}`,
  '-- Ön koşul: şema mevcut (bkz. docs/STAGING_BACKUP.md). Tek işlem: hata olursa hiçbir şey değişmez.',
  'begin;', 'set local session_replication_role = replica;',
  `truncate ${tables.map(table => `public.${table}`).join(', ')} cascade;`]
for (const table of tables) {
  const relative = `data/${table}.json`
  const content = readFileSync(join(dir, relative))
  if (createHash('sha256').update(content).digest('hex') !== manifest.files[relative]) { console.error(`✖ Özet uyuşmuyor: ${relative}`); process.exit(1) }
  const rows = JSON.parse(content)
  if (rows.length !== manifest.tables[table].rows) { console.error(`✖ Satır sayısı uyuşmuyor: ${table}`); process.exit(1) }
  // Kolon listesi hedef tablodan okunur: hesaplanan (generated) kolonlar atlanır, kimlik kolonları korunur.
  const json = dollar(JSON.stringify(rows))
  if (rows.length) parts.push(`do ${dollar(`declare cols text; begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols from pg_attribute
   where attrelid = 'public.${table}'::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  execute format('insert into public.${table} (%s) overriding system value select %s from jsonb_populate_recordset(null::public.${table}, $1)', cols, cols)
    using ${json}::jsonb;
end;`)};`)
}
// Sayaçları en büyük değerin ötesine taşı: bigserial/identity kolonları VE varsayılanı nextval(...) olan kolonlar
// (ör. orders.order_number; dizi kolona bağlı olmayabilir). Aksi halde yeni sipariş numarası çakışır.
parts.push(`do $seq$ declare r record; begin
  for r in select c.relname tbl, a.attname col,
      coalesce(pg_get_serial_sequence(format('public.%I', c.relname), a.attname),
               substring(pg_get_expr(d.adbin, d.adrelid) from $re$nextval\\('([^']+)'$re$)) seq
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relname = any (array[${tables.map(t => `'${t}'`).join(', ')}]) loop
    continue when r.seq is null;
    execute format('select setval(%L, coalesce((select max(%I) from public.%I), 0) + 1, false)', r.seq, r.col, r.tbl);
  end loop; end $seq$;`)
parts.push(`select ${tables.map(t => `(select count(*) from public.${t}) as ${t}`).join(', ')};`, 'commit;', '')
writeFileSync(join(dir, 'restore.sql'), parts.join('\n'))
console.log(`✔ ${join(dir, 'restore.sql')} (${tables.length} tablo)`)
