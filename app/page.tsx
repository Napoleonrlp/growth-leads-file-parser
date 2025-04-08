'use client';
import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function Home() {
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [conversions, setConversions] = useState<any[]>([]);
  const [report, setReport] = useState<any | null>(null);

  // Upload growth & attrition files
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const allCleanedData: any[] = [];

    // Convert the FileList to a proper array
    const fileArray = Array.from(files);

    await Promise.all(
      fileArray.map(async (file) => {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const cleaned = jsonData
          .map((row: any) => {
            const nameRaw = row['C'];
            const hired = row['J'];
            const company = row['A'];
            const dateRaw = row['H'];

            if (!nameRaw || !company || !dateRaw || hired !== 1) return null;

            // Convert "Last, First" to "First Last"
            const nameParts = nameRaw.split(',').map((s: string) => s.trim());
            const nameFormatted =
              nameParts.length === 2
                ? `${nameParts[1]} ${nameParts[0]}`
                : nameRaw;

            const date = new Date(dateRaw);
            const yearMonth = `${date.getFullYear()}-${(date.getMonth() + 1)
              .toString()
              .padStart(2, '0')}`;

            return {
              agent: nameFormatted,
              company,
              date: yearMonth,
            };
          })
          .filter(Boolean);

        allCleanedData.push(...cleaned);
      })
    );

    setParsedData(allCleanedData);
  };

  // Upload leads file
  const handleLeadsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const leads = XLSX.utils.sheet_to_json(worksheet);

    const leadMap = new Map<string, string>(); // Map agent name => source

    leads.forEach((row: any) => {
      const name = row['B']?.toString().trim();
      const source = row['AL']?.toString().trim() || 'Unknown';
      if (name) leadMap.set(name.toLowerCase(), source);
    });

    const matched = parsedData.map((agent) => {
      const name = agent.agent.toLowerCase();
      const source = leadMap.get(name);
      return {
        ...agent,
        isConversion: !!source,
        source: source || 'N/A',
      };
    });

    setParsedData(matched);
    setConversions(matched.filter((m) => m.isConversion));
  };

  // Generate report summary
  const generateReport = () => {
    console.log('✅ Generate Report clicked');

    if (parsedData.length === 0) return;

    const yearly = new Map<string, { leads: number; conversions: number }>();
    const brokerages = new Map<string, { leads: number; conversions: number }>();
    const sources = new Map<string, { leads: number; conversions: number }>();

    parsedData.forEach((row) => {
      const year = row.date?.split('-')[0];
      const brokerage = row.company || 'Unknown';
      const source = row.source || 'Unknown';

      if (!year) return;

      // Update yearly counts
      if (!yearly.has(year)) yearly.set(year, { leads: 0, conversions: 0 });
      yearly.get(year)!.leads += 1;
      if (row.isConversion) yearly.get(year)!.conversions += 1;

      // Update brokerage counts
      if (!brokerages.has(brokerage))
        brokerages.set(brokerage, { leads: 0, conversions: 0 });
      brokerages.get(brokerage)!.leads += 1;
      if (row.isConversion) brokerages.get(brokerage)!.conversions += 1;

      // Update source counts
      if (!sources.has(source)) sources.set(source, { leads: 0, conversions: 0 });
      sources.get(source)!.leads += 1;
      if (row.isConversion) sources.get(source)!.conversions += 1;
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
        rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%',
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
