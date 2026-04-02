const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');

chromium.use(StealthPlugin());

// Mapowanie nazwy oddziału PGE → Twój region w tablicy
const REGION_MAP = {
  'Skarżysko': 'Skarżysko',
  'Skarżysko-Kamienna': 'Skarżysko',
  'Rzeszów': 'Rzeszów',
  'Łódź': 'Łódź',
  'Warszawa': 'Warszawa',
};

const TARGET_REGIONS = Object.keys(REGION_MAP);

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
    locale: 'pl-PL',
  });
  const page = await context.newPage();

  console.log('Otwieranie portalu PGE SWPP2...');
  
  await page.goto(
    'https://swpp2.gkpge.pl/app/demand/notice/public/current/list',
    { waitUntil: 'networkidle', timeout: 60000 }
  );

  // Poczekaj na załadowanie tabeli
  await page.waitForSelector('table, .tender-list, [class*="list"]', { timeout: 30000 });

  // Zbierz wszystkie przetargi z listy
  const tenders = await page.evaluate((targetRegions) => {
    const rows = document.querySelectorAll('tr[data-id], .tender-row, tbody tr');
    const results = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;

      const title = cells[1]?.textContent?.trim() || cells[0]?.textContent?.trim();
      const buyer = cells[2]?.textContent?.trim() || '';
      const deadline = cells[3]?.textContent?.trim() || cells[4]?.textContent?.trim() || '';
      const link = row.querySelector('a')?.href || '';
      const externalId = row.getAttribute('data-id') || link.split('/').pop() || title;

      // Sprawdź czy to PGE i czy to nasz region
      const fullText = (title + ' ' + buyer).toLowerCase();
      const matchedRegion = targetRegions.find(r => 
        buyer.toLowerCase().includes(r.toLowerCase()) || 
        title.toLowerCase().includes(r.toLowerCase())
      );

      if (matchedRegion && (fullText.includes('pge') || buyer.includes('PGE'))) {
        results.push({ title, buyer, deadline, link, externalId, matchedRegion });
      }
    });

    return results;
  }, TARGET_REGIONS);

  console.log(`Znaleziono ${tenders.length} przetargów PGE dla docelowych regionów`);

  // Upsert do Supabase
  for (const t of tenders) {
    const region = REGION_MAP[t.matchedRegion] || t.matchedRegion;
    
    // Parsowanie daty
    let deadline = null;
    if (t.deadline) {
      const parts = t.deadline.match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
      if (parts) deadline = `${parts[3]}-${parts[2].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
    }

    const { error } = await supabase.from('tenders').upsert({
      external_id: t.externalId,
      title: t.title,
      source: 'PGE',
      region: region,
      status: 'Nowy',
      deadline: deadline,
      url: t.link,
      raw_data: { buyer: t.buyer, scraped_at: new Date().toISOString() },
    }, { 
      onConflict: 'external_id',
      ignoreDuplicates: false  // aktualizuj istniejące
    });

    if (error) console.error('Błąd upsert:', error.message);
    else console.log(`✓ ${region}: ${t.title.substring(0, 60)}`);
  }

  await browser.close();
  console.log('Gotowe!');
})();
