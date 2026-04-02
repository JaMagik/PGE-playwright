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

  const jsScenario = JSON.stringify({
    instructions: [
      { wait: 8000 },
      { wait_for: 'tr' },
      { wait: 3000 }
    ]
  });

  const params = new URLSearchParams({
    api_key: apiKey,
    url: url,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'pl',
    js_scenario: jsScenario,
    json_response: 'false',
  });

  const response = await fetch('https://app.scrapingbee.com/api/v1/?' + params);
  const html = await response.text();

  console.log('Status ScrapingBee:', response.status);

  if (response.status !== 200) {
    console.log('Błąd ScrapingBee:', html.substring(0, 500));
    process.exit(1);
  }

  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Wyciągnij tylko wiersze danych (class="dataRow")
  const dataRowRegex = /<tr[^>]*class="dataRow[^"]*"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  const tenders = [];
  let rowMatch;

  while ((rowMatch = dataRowRegex.exec(html)) !== null) {
    const rowId = rowMatch[1];
    const rowHtml = rowMatch[2];

    const cells = [];
    let tdMatch;
    tdRegex.lastIndex = 0;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(stripTags(tdMatch[1]));
    }

    if (cells.length < 7) continue;

    // Kolumny wg struktury tabeli:
    // 0: Numer postępowania
    // 1: Nazwa postępowania
    // 2: Typ postępowania
    // 3: Tryb postępowania
    // 4: Rodzaj zamówienia
    // 5: Organizator postępowania
    // 6: Spółka Organizatora
    // 7: Kategoria
    // 8: Termin publikacji
    // 9: Termin składania ofert

    const number = cells[0] || '';
    const name = cells[1] || '';
    const organizer = cells[5] || '';
    const company = cells[6] || '';
    const deadline = cells[9] || '';

    const fullText = [number, name, organizer, company].join(' ');

    // Sprawdź czy to PGE
    if (!fullText.toLowerCase().includes('pge') &&
        !organizer.toLowerCase().includes('pge') &&
        !company.toLowerCase().includes('pge')) {
      continue;
    }

    // Znajdź region
    const matchedRegion = REGION_KEYWORDS.find(r =>
      fullText.toLowerCase().includes(r.toLowerCase())
    );

    if (!matchedRegion) continue;

    // Parsuj datę (format dd-mm-yyyy lub dd.mm.yyyy)
    const dateMatch = deadline.match(/(\d{2})[-.](\d{2})[-.](\d{4})/);
    const deadlineParsed = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : null;

    tenders.push({
      external_id: rowId,
      title: name || number,
      source: 'PGE',
      region: matchedRegion,
      status: 'Nowy',
      deadline: deadlineParsed,
      url: `https://swpp2.gkpge.pl/app/demand/notice/public/current/demandPublic.html?noticeId=${rowId}`,
      raw_data: {
        number: number,
        buyer: organizer || company,
        company: company,
        scraped_at: new Date().toISOString(),
      }
    });
  }

  console.log(`Znaleziono ${tenders.length} przetargów PGE dla docelowych regionów`);

  for (const tender of tenders) {
    console.log(`Region: ${tender.region} | ${tender.title.substring(0, 80)}`);

    const { error } = await supabase.from('tenders').upsert(tender, {
      onConflict: 'external_id'
    });

    if (error) console.error('Błąd upsert:', error.message);
    else console.log('✓ Zapisano');
  }

  // Diagnostyka jeśli brak wyników
  if (tenders.length === 0) {
    console.log('Brak przetargów dla regionów - wszystkie wiersze danych:');
    const allRows = [];
    let rm;
    const diagRegex = /<tr[^>]*class="dataRow[^"]*"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((rm = diagRegex.exec(html)) !== null) {
      const cells2 = [];
      let tm;
      tdRegex.lastIndex = 0;
      while ((tm = tdRegex.exec(rm[2])) !== null) {
        cells2.push(stripTags(tm[1]));
      }
      console.log(`ID ${rm[1]}:`, cells2.slice(0, 7).join(' | '));
    }
  }

  console.log('Gotowe!');
})();
