'use client';
import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function Home() {
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [conversions, setConversions] = useState<any[]>([]);
  const [report, setReport] = useState<any | null>(null);

 const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const fileList = e.target.files;
  if (!fileList) return;

  const files = Array.from(fileList);
  const allCleanedData: any[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    console.log("📦 First row of uploaded growth file:", jsonData[0]);

    const cleaned = jsonData
      .map((row: any) => {
        const nameRaw = row['Agent'];
        const hired = row['Hired'];
        const company = row['Company Name'];
        const dateRaw = row['Hire/Termination Date'];

        if (!nameRaw || !company || !dateRaw || hired !== 1) return null;

        // Convert "Last, First" → "First Last"
        const nameParts = nameRaw.split(',').map((s: string) => s.trim());
        const nameFormatted =
          nameParts.length === 2
            ? `${nameParts[1]} ${nameParts[0]}`
            : nameRaw;

        // Convert Excel serial date to real Date
        const date = XLSX.SSF.parse_date_code(dateRaw);
        const yearMonth = `${date.y}-${String(date.m).padStart(2, '0')}`;

        return {
          agent: nameFormatted,
          company,
          date: yearMonth,
        };
      })
      .filter(Boolean);

    allCleanedData.push(...cleaned);
  }

  setParsedData(allCleanedData);
  // Debug
  // @ts-ignore
  window.parsedData = allCleanedData;
};


  const handleLeadsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const leads = XLSX.utils.sheet_to_json(worksheet);
    // @ts-ignore
window.leadsRaw = leads;


  console.log("🔍 First row of leads file:", leads[0]);

  const leadMap = new Map<string, string>();

  leads.forEach((row: any) => {
    const name = row['lead_name']?.toString().trim();
    const blob = row['lead_text'] || row['lead_agent_text'] || '';
    const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
    const source = sourceMatch ? sourceMatch[1].trim() : 'Unknown';

    if (name) {
      const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
      leadMap.set(normalizedName, source);
    }
  });

  const matched = parsedData.map((agent) => {
    const name = agent.agent.toLowerCase().replace(/\s+/g, ' ').trim();
    const source = leadMap.get(name);

    return {
      ...agent,
      isConversion: !!source,
      source: source || 'N/A',
    };
  });

  setParsedData(matched);
  setConversions(matched.filter((m) => m.isConversion));

  // Debug: expose to console
  // @ts-ignore
  window.parsedData = matched;
  // @ts-ignore
  window.conversions = matched.filter((m) => m.isConversion);
};


  const generateReport = () => {
  console.log('✅ Generate Report clicked');

  // @ts-ignore - allow accessing custom global variable
  if (parsedData.length === 0 || typeof window['leadsRaw'] === 'undefined') return;

  // @ts-ignore
  const leadsRaw: any[] = window['leadsRaw'];

  const yearly = new Map<string, { leads: number; conversions: number }>();
  const brokerages = new Map<string, { leads: number; conversions: number }>();
  const sources = new Map<string, { leads: number; conversions: number }>();

  // ✅ Count TOTAL leads per source from raw leads file
  leadsRaw.forEach((row: any) => {
    const blob = row['lead_text'] || row['lead_agent_text'] || '';
    const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
    const source = (sourceMatch ? sourceMatch[1].trim() : 'Unknown') || 'N/A';
    const key = source.toUpperCase().trim();

    if (!sources.has(key)) {
      sources.set(key, { leads: 0, conversions: 0 });
    }
    sources.get(key)!.leads += 1;
  });

  // ✅ Count conversions per year, brokerage, and source
  parsedData.forEach((row) => {
    const year = row.date?.split('-')[0];
    const brokerage = row.company || 'Unknown';
    const source = (row.source || 'N/A').toUpperCase().trim();

    if (!yearly.has(year)) yearly.set(year, { leads: 0, conversions: 0 });
    yearly.get(year)!.leads += 1;
    if (row.isConversion) yearly.get(year)!.conversions += 1;

    if (!brokerages.has(brokerage))
      brokerages.set(brokerage, { leads: 0, conversions: 0 });
    brokerages.get(brokerage)!.leads += 1;
    if (row.isConversion) brokerages.get(brokerage)!.conversions += 1;

    if (!sources.has(source)) {
      sources.set(source, { leads: 0, conversions: 0 });
    }
    if (row.isConversion) {
      sources.get(source)!.conversions += 1;
    }
  });

  setReport({
    yearly: Array.from(yearly.entries()).map(([year, stats]) => ({
      year,
      ...stats,
      rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%',
    })),
    brokerages: Array.from(brokerages.entries()).map(([name, stats]) => ({
      name,
      ...stats,
      rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%',
    })),
    sources: Array.from(sources.entries()).map(([tag, stats]) => ({
      tag,
      ...stats,
      rate:
        stats.leads > 0
          ? ((stats.conversions / stats.leads) * 100).toFixed(2) + '%'
          : '0.00%',
    })),
  });
};



  return (
    <div style={{ padding: '2rem' }}>
      <h1>📊 Growth & Leads File Parser</h1>

      <h2>📁 Upload Growth & Attrition File(s)</h2>
      <input
        type="file"
        accept=".xlsx, .xls, .csv"
        multiple
        onChange={handleFileUpload}
      />

      <hr style={{ margin: '2rem 0' }} />

      <h2>📥 Upload Leads File</h2>
      <input
        type="file"
        accept=".xlsx, .xls, .csv"
        onChange={handleLeadsUpload}
      />

      <hr style={{ margin: '2rem 0' }} />

      <h2>✅ Hired Agents (First 5)</h2>
      <pre>{JSON.stringify(parsedData.slice(0, 5), null, 2)}</pre>

      <h2>🔥 Conversions (First 5)</h2>
      <pre>{JSON.stringify(conversions.slice(0, 5), null, 2)}</pre>

      <button
        onClick={generateReport}
        style={{
          marginTop: '1rem',
          padding: '10px 20px',
          background: 'black',
          color: 'white',
          borderRadius: '6px',
        }}
      >
        🚀 Generate Report
      </button>

      {report && (
        <div style={{ marginTop: '2rem' }}>
          <h2>📈 Overall Performance by Year</h2>
          <ul>
            {report.yearly.map((y: any) => (
              <li key={y.year}>
                <strong>{y.year}</strong>: {y.conversions} hires from {y.leads} leads → {y.rate}
              </li>
            ))}
          </ul>

          <h2>🏢 Top Converting Brokerages</h2>
          <ul>
            {report.brokerages.map((b: any, i: number) => (
              <li key={i}>
                {b.name}: {b.conversions}/{b.leads} → {b.rate}
              </li>
            ))}
          </ul>

          <h2>🏷️ Top Source Tags</h2>
          <ul>
            {report.sources.map((s: any, i: number) => (
              <li key={i}>
                {s.tag}: {s.conversions}/{s.leads} → {s.rate}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
