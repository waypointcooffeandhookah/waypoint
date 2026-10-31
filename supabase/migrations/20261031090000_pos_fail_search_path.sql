-- pos_private.fail için arama yolunu sabitler (Supabase uyarısı: function_search_path_mutable).
-- Etkisi yalnızca bu fonksiyonun yapılandırmasıdır: gövdesi, yetkileri ve veriler değişmez.
-- Fonksiyon yalnızca hata fırlatır, hiçbir tabloya veya public nesnesine başvurmaz.
alter function pos_private.fail(text, text) set search_path = pg_catalog, pg_temp;
