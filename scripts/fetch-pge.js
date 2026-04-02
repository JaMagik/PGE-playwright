const { createClient } = require('@supabase/supabase-js');

const REGION_KEYWORDS = ['Skarżysko', 'Rzeszów', 'Łódź', 'Warszawa'];

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  console.log('Pobieranie przez ScrapingBee...');

  const url = 'https://swpp2.gkpge.pl/app/demand/notice/public/current/list';
  const apiKey = process.env.SCRAPINGBEE_API_KEY;

  const scrapingBeeUrl = 'https://app.scrapingbee.com/api/v1/?' + new URLSearchParams({
    api_key: apiKey,
    url: url,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'pl',
    wait: '8000',
    wait_for: 'table',
    json_response: 'false',
  });

  const response = await fetch(scrapingBeeUrl);
  const html = await response.text();

  console.log('Status ScrapingBee:', response.status);
  console.log('Pierwsze 500 znaków HTML:', html.substring(0, 500));

  if (response.status !== 200 || html.includes('odrzucona')) {
    console.log('ScrapingBee nie przeszło przez ochronę');
    process.exit(1);
  }

  // Parsowanie HTML - szukamy wierszy tabeli
  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /href="([^"]*notice[^"]*)"/i;
  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(stripTags(tdMatch[1]));
    }
    if (cells.length < 2) continue;

    const rowText = cells.join(' ');
    const linkMatch = linkRegex.exec(rowHtml);
    const href = linkMatch ? 'https://swpp2.gkpge.pl' + linkMatch[1] : '';

    const matchedRegion = REGION_KEYWORDS.find(r =>
      rowText.toLowerCase().includes(r.toLowerCase())
    );

    if (matchedRegion && rowText.toLowerCase().includes('pge')) {
      rows.push({ cells, href, region: matchedRegion, rowText });
    }
  }

  console.log(`Znaleziono ${rows.length} przetargów PGE dla docelowych regionów`);

  for (const row of rows) {
    console.log('Region:', row.region, '| Tekst:', row.rowText.substring(0, 100));

    const dateMatch = row.rowText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const deadline = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : null;

    const title = row.cells[1] || row.cells[0] || row.rowText.substring(0, 100);
    const buyer = row.cells.find(c => c.toLowerCase().includes('pge')) || 'PGE';
    const externalId = row.href
      ? row.href.split('/').pop()
      : Buffer.from(title).toString('base64').substring(0, 20);

    const { error } = await supabase.from('tenders').upsert({
      external_id: externalId,
      title: title,
      source: 'PGE',
      region: row.region,
      status: 'Nowy',
      deadline: deadline,
      url: row.href || url,
      raw_data: {
        buyer: buyer,
        scraped_at: new Date().toISOString(),
        cells: row.cells,
      },
    }, { onConflict: 'external_id' });

    if (error) console.error('Błąd upsert:', error.message);
    else console.log('✓ Zapisano:', title.substring(0, 60));
  }

  if (rows.length === 0) {
    console.log('Brak wyników - fragment HTML 2000-5000:');
    console.log(html.substring(2000, 5000));
  }

  console.log('Gotowe!');
})();
