const { createClient } = require('@supabase/supabase-js');

// Słowa kluczowe z odmianami + kody oddziałów w numerze POST
const REGION_MAP = [
  {
    region: 'Skarżysko',
    keywords: ['skarżysk', 'skarzysk', '/OSK/'],
  },
  {
    region: 'Rzeszów',
    keywords: ['rzeszow', 'rzeszów', '/PEC/PEC/', '/ORP/'],
  },
  {
    region: 'Łódź',
    keywords: ['łódź', 'łodzi', 'łódzk', 'lodzi', '/OL/'],
  },
  {
    region: 'Warszawa',
    keywords: ['warszaw', '/OW/'],
  },
];

function detectRegion(text) {
  const lower = text.toLowerCase();
  for (const entry of REGION_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return entry.region;
      }
    }
  }
  return null;
}

async function fetchPage(apiKey, url, pageNum = 0) {
  const pageUrl = pageNum > 0
    ? `${url}?pageNum=${pageNum}`
    : url;

  const jsScenario = JSON.stringify({
    instructions: [
      { wait: 8000 },
      { wait_for: 'tr.dataRow' },
      { wait: 3000 }
    ]
  });

  const params = new URLSearchParams({
    api_key: apiKey,
    url: pageUrl,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'pl',
    js_scenario: jsScenario,
    json_response: 'false',
  });

  const response = await fetch('https://app.scrapingbee.com/api/v1/?' + params);
  return response.text();
}

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const url = 'https://swpp2.gkpge.pl/app/demand/notice/public/current/list';
  const apiKey = process.env.SCRAPINGBEE_API_KEY;

  console.log('Pobieranie strony 1...');
  const html = await fetchPage(apiKey, url, 0);
  console.log('Status: 200, długość HTML:', html.length);

  // Sprawdź czy jest paginacja
  const totalMatch = html.match(/Pozycje\s+\d+-(\d+)\s+z\s+(\d+)/i) ||
                     html.match(/(\d+)\s*-\s*(\d+)\s*z\s*(\d+)/i);
  if (totalMatch) {
    console.log('Paginacja:', totalMatch[0]);
  }

  const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
    if (cells.length < 5) continue;

    const number   = cells[0] || '';
    const name     = cells[1] || '';
    const organizer = cells[5] || '';
    const company  = cells[6] || '';

    // Sprawdź czy to PGE (dowolna spółka)
    const fullText = [number, name, organizer, company].join(' ');
    if (!fullText.toLowerCase().includes('pge') && company !== '--') continue;

    // Wykryj region
    const region = detectRegion(fullText);

    // Wypisz WSZYSTKIE wiersze żeby zobaczyć co jest dostępne
    console.log(`[${region || 'BRAK'}] ID ${rowId}: ${number} | ${name.substring(0, 60)} | ${company}`);

    if (!region) continue;

    // Parsuj datę deadline (cells[9] = Termin składania)
    const deadlineText = cells[9] || '';
    const dateMatch = deadlineText.match(/(\d{2})[-.](\d{2})[-.](\d{4})/);
    const deadline = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : null;

    tenders.push({
      external_id: rowId,
      title: name || number,
      source: 'PGE',
      region: region,
      status: 'Nowy',
      deadline: deadline,
      url: `https://swpp2.gkpge.pl/app/demand/notice/public/current/demandPublic.html?noticeId=${rowId}`,
      raw_data: {
        number: number,
        buyer: organizer || company,
        company: company,
        scraped_at: new Date().toISOString(),
      }
    });
  }

  console.log(`\nZnaleziono ${tenders.length} przetargów dla docelowych regionów`);

  for (const tender of tenders) {
    console.log(`✓ ${tender.region}: ${tender.title.substring(0, 70)}`);
    const { error } = await supabase.from('tenders').upsert(tender, {
      onConflict: 'external_id'
    });
    if (error) console.error('Błąd upsert:', error.message);
  }

  console.log('Gotowe!');
})();
