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

    const totalLeadsByYear = new Map<string, number>();
    const totalLeadsBySource = new Map<string, number>();

    leadsRaw.forEach((row: any) => {
      const blob = row['lead_text'] || row['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = (sourceMatch ? sourceMatch[1].trim() : 'Unknown') || 'N/A';
      const sourceKey = source.toUpperCase().trim();

      const date = new Date(row['lead_created_at'] || row['created_at']);
      const year = String(date.getFullYear());

      if (!totalLeadsByYear.has(year)) totalLeadsByYear.set(year, 0);
      totalLeadsByYear.set(year, totalLeadsByYear.get(year)! + 1);

      if (!totalLeadsBySource.has(sourceKey)) totalLeadsBySource.set(sourceKey, 0);
      totalLeadsBySource.set(sourceKey, totalLeadsBySource.get(sourceKey)! + 1);
    });

    const yearly = new Map<string, { leads: number; conversions: number }>();
    const matchedYearly = new Map<string, { leads: number; conversions: number }>();
    const brokerages = new Map<string, { leads: number; conversions: number }>();
    const sources = new Map<string, { leads: number; conversions: number }>();
    const matchedSources = new Map<string, { leads: number; conversions: number }>();
    const sourcesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();
    const matchedSourcesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();

    parsedData.forEach((row) => {
      const hireYear = row.date?.split('-')[0];
      const source = (row.source || 'N/A').toUpperCase().trim();
      const brokerage = row.company || 'Unknown';
      const leadYear = row.leadYear;

      if (!yearly.has(leadYear)) yearly.set(leadYear, { leads: 0, conversions: 0 });
      yearly.get(leadYear)!.leads += 1;
      if (row.isConversion) yearly.get(leadYear)!.conversions += 1;

      if (!brokerages.has(brokerage)) brokerages.set(brokerage, { leads: 0, conversions: 0 });
      brokerages.get(brokerage)!.leads += 1;
      if (row.isConversion) brokerages.get(brokerage)!.conversions += 1;

      if (!sources.has(source)) sources.set(source, { leads: totalLeadsBySource.get(source) || 0, conversions: 0 });
      if (row.isConversion) sources.get(source)!.conversions += 1;

      if (!sourcesByYear.has(leadYear)) sourcesByYear.set(leadYear, new Map());
      const srcMap = sourcesByYear.get(leadYear)!;
      if (!srcMap.has(source)) srcMap.set(source, { leads: 0, conversions: 0 });
      srcMap.get(source)!.leads += 1;
      if (row.isConversion) srcMap.get(source)!.conversions += 1;

      if (row.isConversion && leadYear && parseInt(hireYear) === parseInt(leadYear)) {
        if (!matchedYearly.has(leadYear)) matchedYearly.set(leadYear, { leads: 0, conversions: 0 });
        matchedYearly.get(leadYear)!.leads += 1;
        matchedYearly.get(leadYear)!.conversions += 1;

        if (!matchedSources.has(source)) matchedSources.set(source, { leads: 0, conversions: 0 });
        matchedSources.get(source)!.leads += 1;
        matchedSources.get(source)!.conversions += 1;

        if (!matchedSourcesByYear.has(leadYear)) matchedSourcesByYear.set(leadYear, new Map());
        const matchedMap = matchedSourcesByYear.get(leadYear)!;
        if (!matchedMap.has(source)) matchedMap.set(source, { leads: 0, conversions: 0 });
        matchedMap.get(source)!.leads += 1;
        matchedMap.get(source)!.conversions += 1;
      }
    });

    const sortMap = (map: Map<string, any>) =>
      Array.from(map.entries())
        .map(([key, stats]) => ({ name: key, ...stats, rate: ((stats.conversions / stats.leads) * 100).toFixed(2) + '%' }))
        .sort((a, b) => b.conversions - a.conversions);

    setReport({
      yearly: sortMap(yearly),
      matchedYearly: sortMap(matchedYearly),
      brokerages: sortMap(brokerages),
      sources: sortMap(sources),
      matchedSources: sortMap(matchedSources),
      sourcesByYear: Array.from(sourcesByYear.entries()).map(([year, map]) => ({
        year,
        sources: sortMap(map),
      })),
      matchedSourcesByYear: Array.from(matchedSourcesByYear.entries()).map(([year, map]) => ({
        year,
        sources: sortMap(map),
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
          <section style={{ marginBottom: '2rem' }}>
            <h2>🔥 Total Conversions by Lead Year</h2>
            <ul>
              {report.yearly.map((r: any) => (
                <li key={r.name}>{r.name}: {r.conversions}/{r.leads} → {r.rate}</li>
              ))}
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2>🎯 Lead-Year Conversions Only</h2>
            <ul>
              {report.matchedYearly.map((r: any) => (
                <li key={r.name}>{r.name}: {r.conversions}/{r.leads} → {r.rate}</li>
              ))}
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2>🏢 Top Converting Brokerages</h2>
            <ul>
              {report.brokerages.map((b: any, i: number) => (
                <li key={i}>{b.name}: {b.conversions}/{b.leads} → {b.rate}</li>
              ))}
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2>🏷️ Top Source Tags (All)</h2>
            <ul>
              {report.sources.map((s: any, i: number) => (
                <li key={i}>{s.name}: {s.conversions}/{s.leads} → {s.rate}</li>
              ))}
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2>🎯 Top Source Tags (Matched Only)</h2>
            <ul>
              {report.matchedSources.map((s: any, i: number) => (
                <li key={i}>{s.name}: {s.conversions}/{s.leads} → {s.rate}</li>
              ))}
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2>📆 Source Breakdown by Lead Year (All Conversions)</h2>
            {report.sourcesByYear.map((y: any) => (
              <div key={y.year}>
                <h3>{y.year}</h3>
                <ul>
                  {y.sources.map((s: any, i: number) => (
                    <li key={i}>{s.name}: {s.conversions}/{s.leads} → {s.rate}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2>📆 Source Breakdown by Lead Year (Lead-Year Matched Only)</h2>
            {report.matchedSourcesByYear.map((y: any) => (
              <div key={y.year}>
                <h3>{y.year}</h3>
                <ul>
                  {y.sources.map((s: any, i: number) => (
                    <li key={i}>{s.name}: {s.conversions}/{s.leads} → {s.rate}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
