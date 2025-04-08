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

      const cleaned = jsonData
        .map((row: any) => {
          const nameRaw = row['Agent'];
          const hired = row['Hired'];
          const company = row['Company Name'];
          const dateRaw = row['Hire/Termination Date'];

          if (!nameRaw || !company || !dateRaw || hired !== 1) return null;

          const nameParts = nameRaw.split(',').map((s: string) => s.trim());
          const nameFormatted =
            nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : nameRaw;

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

    const leadMap = new Map<string, { source: string; leadYear: string }>();

    leads.forEach((row: any) => {
      const name = row['lead_name']?.toString().trim();
      const blob = row['lead_text'] || row['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = sourceMatch ? sourceMatch[1].trim() : 'Unknown';

      const date = new Date(row['lead_created_at'] || row['created_at']);
      const leadYear = String(date.getFullYear());

      if (name) {
        const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
        leadMap.set(normalizedName, { source, leadYear });
      }
    });

    const matched = parsedData.map((agent) => {
      const name = agent.agent.toLowerCase().replace(/\s+/g, ' ').trim();
      const match = leadMap.get(name);
      const hireYear = agent.date.split('-')[0];

      return {
        ...agent,
        isConversion: !!match && parseInt(hireYear) >= parseInt(match.leadYear),
        source: match?.source || 'N/A',
        leadYear: match?.leadYear || null,
      };
    });

    setParsedData(matched);
    setConversions(matched.filter((m) => m.isConversion));
    // @ts-ignore
    window.parsedData = matched;
    // @ts-ignore
    window.conversions = matched.filter((m) => m.isConversion);
    // @ts-ignore
    window.leadsRaw = leads;
  };

  const generateReport = () => {
    // @ts-ignore
    if (parsedData.length === 0 || typeof window['leadsRaw'] === 'undefined') return;

    // @ts-ignore
    const leadsRaw: any[] = window['leadsRaw'];

    const yearly = new Map<string, { leads: number; conversions: number }>();
    const matchedYearly = new Map<string, { leads: number; conversions: number }>();
    const sourcesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();
    const matchedSourcesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();

    parsedData.forEach((row) => {
      const hireYear = row.date?.split('-')[0];
      const source = (row.source || 'N/A').toUpperCase().trim();
      const leadYear = row.leadYear;

      // All conversions (regardless of time logic)
      if (!yearly.has(hireYear)) yearly.set(hireYear, { leads: 0, conversions: 0 });
      yearly.get(hireYear)!.leads += 1;
      if (row.isConversion) yearly.get(hireYear)!.conversions += 1;

      if (!sourcesByYear.has(hireYear)) sourcesByYear.set(hireYear, new Map());
      const yearMap = sourcesByYear.get(hireYear)!;
      if (!yearMap.has(source)) yearMap.set(source, { leads: 0, conversions: 0 });
      yearMap.get(source)!.leads += 1;
      if (row.isConversion) yearMap.get(source)!.conversions += 1;

      // Strict match: hireYear >= leadYear
      if (row.isConversion && leadYear && parseInt(hireYear) === parseInt(leadYear)) {
        if (!matchedYearly.has(hireYear)) matchedYearly.set(hireYear, { leads: 0, conversions: 0 });
        matchedYearly.get(hireYear)!.leads += 1;
        matchedYearly.get(hireYear)!.conversions += 1;

        if (!matchedSourcesByYear.has(hireYear)) matchedSourcesByYear.set(hireYear, new Map());
        const matchedMap = matchedSourcesByYear.get(hireYear)!;
        if (!matchedMap.has(source)) matchedMap.set(source, { leads: 0, conversions: 0 });
        matchedMap.get(source)!.leads += 1;
        matchedMap.get(source)!.conversions += 1;
      }
    });

    setReport({
      yearly: Array.from(yearly.entries()).map(([year, stats]) => ({
        year,
        ...stats,
        rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%',
      })),
      matchedYearly: Array.from(matchedYearly.entries()).map(([year, stats]) => ({
        year,
        ...stats,
        rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%',
      })),
      sourcesByYear: Array.from(sourcesByYear.entries()).map(([year, map]) => ({
        year,
        sources: Array.from(map.entries()).map(([source, stats]) => ({
          source,
          ...stats,
          rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%',
        })),
      })),
      matchedSourcesByYear: Array.from(matchedSourcesByYear.entries()).map(([year, map]) => ({
        year,
        sources: Array.from(map.entries()).map(([source, stats]) => ({
          source,
          ...stats,
          rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%',
        })),
      })),
    });
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>📊 Growth & Leads File Parser</h1>
      <input type="file" multiple onChange={handleFileUpload} />
      <input type="file" onChange={handleLeadsUpload} />
      <button onClick={generateReport}>Generate Report</button>

      {report && (
        <div style={{ marginTop: '2rem' }}>
          <h2>🔥 Total Conversions by Year</h2>
          <ul>
            {report.yearly.map((r: any) => (
              <li key={r.year}>{r.year}: {r.conversions}/{r.leads} → {r.rate}</li>
            ))}
          </ul>

          <h2>🎯 Lead-Year Conversions Only</h2>
          <ul>
            {report.matchedYearly.map((r: any) => (
              <li key={r.year}>{r.year}: {r.conversions}/{r.leads} → {r.rate}</li>
            ))}
          </ul>

          <h2>🔥 Source Breakdown by Year (All Conversions)</h2>
          {report.sourcesByYear.map((y: any) => (
            <div key={y.year}>
              <h3>{y.year}</h3>
              <ul>
                {y.sources.map((s: any, i: number) => (
                  <li key={i}>{s.source}: {s.conversions}/{s.leads} → {s.rate}</li>
                ))}
              </ul>
            </div>
          ))}

          <h2>🎯 Source Breakdown by Year (Lead-Year Matched)</h2>
          {report.matchedSourcesByYear.map((y: any) => (
            <div key={y.year}>
              <h3>{y.year}</h3>
              <ul>
                {y.sources.map((s: any, i: number) => (
                  <li key={i}>{s.source}: {s.conversions}/{s.leads} → {s.rate}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
