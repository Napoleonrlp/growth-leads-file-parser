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
    const validLeads: any[] = [];
    const leadCountsByYear = new Map<string, number>();

    leads.forEach((row: any) => {
      const name = row['lead_name']?.toString().trim();
      const blob = row['lead_text'] || row['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = sourceMatch ? sourceMatch[1].trim() : 'Unknown';

      const dateStr = row['lead_created_at'] || row['created_at'];
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;

      const leadYear = String(date.getFullYear());

      if (!leadCountsByYear.has(leadYear)) leadCountsByYear.set(leadYear, 0);
      leadCountsByYear.set(leadYear, leadCountsByYear.get(leadYear)! + 1);

      if (name) {
        validLeads.push(row);
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
    window.leadsRaw = validLeads;
    // @ts-ignore
    window.leadCountsByYear = leadCountsByYear;
  };

  const generateReport = () => {
    // @ts-ignore
    if (parsedData.length === 0 || typeof window['leadsRaw'] === 'undefined') return;

    // @ts-ignore
    const leadsRaw: any[] = window['leadsRaw'];
    // @ts-ignore
    const leadCountsByYear: Map<string, number> = window['leadCountsByYear'];

    const yearly = new Map<string, { leads: number; conversions: number }>();
    const brokerages = new Map<string, { leads: number; conversions: number }>();
    const sources = new Map<string, { leads: number; conversions: number }>();
    const sourcesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();

    const sourceTotals = new Map<string, number>();

    leadsRaw.forEach((row: any) => {
      const blob = row['lead_text'] || row['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = (sourceMatch ? sourceMatch[1].trim() : 'Unknown') || 'N/A';
      const dateStr = row['lead_created_at'] || row['created_at'];
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;
      const year = String(date.getFullYear());

      const sourceKey = source.toUpperCase().trim();
      if (!sourceTotals.has(sourceKey)) sourceTotals.set(sourceKey, 0);
      sourceTotals.set(sourceKey, sourceTotals.get(sourceKey)! + 1);
    });

    parsedData.forEach((row: any) => {
      const year = row.leadYear;
      const source = (row.source || 'N/A').toUpperCase().trim();
      const brokerage = row.company || 'Unknown';

      if (!yearly.has(year)) yearly.set(year, { leads: leadCountsByYear.get(year) || 0, conversions: 0 });
      if (row.isConversion) yearly.get(year)!.conversions += 1;

      if (!brokerages.has(brokerage)) brokerages.set(brokerage, { leads: 0, conversions: 0 });
      brokerages.get(brokerage)!.leads += 1;
      if (row.isConversion) brokerages.get(brokerage)!.conversions += 1;

      if (!sources.has(source)) sources.set(source, { leads: sourceTotals.get(source) || 0, conversions: 0 });
      if (row.isConversion) sources.get(source)!.conversions += 1;

      if (!sourcesByYear.has(year)) sourcesByYear.set(year, new Map());
      const byYear = sourcesByYear.get(year)!;
      if (!byYear.has(source)) byYear.set(source, { leads: 0, conversions: 0 });
      byYear.get(source)!.leads += 1;
      if (row.isConversion) byYear.get(source)!.conversions += 1;
    });

    const sortMap = (map: Map<string, any>) =>
      Array.from(map.entries())
        .map(([name, data]) => ({
          name,
          ...data,
          rate: ((data.conversions / data.leads) * 100).toFixed(2) + '%',
        }))
        .sort((a, b) => b.conversions - a.conversions);

    const sortedReport = {
      yearly: sortMap(yearly),
      brokerages: sortMap(brokerages),
      sources: sortMap(sources),
      sourcesByYear: Array.from(sourcesByYear.entries()).map(([year, srcMap]) => ({
        year,
        sources: sortMap(srcMap),
      })),
    };

    setReport(sortedReport);
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>📊 Growth & Leads File Parser</h1>
      <input type="file" multiple onChange={handleFileUpload} />
      <input type="file" onChange={handleLeadsUpload} />
      <button onClick={generateReport}>Generate Report</button>

      {report && (
        <div style={{ marginTop: '2rem' }}>
          <h2>🎯 Lead-Year Conversions</h2>
          <ul>
            {report.yearly.map((item: any) => (
              <li key={item.name}>{item.name}: {item.conversions}/{item.leads} → {item.rate}</li>
            ))}
          </ul>

          <h2>🏢 Top Converting Brokerages</h2>
          <ul>
            {report.brokerages.map((item: any) => (
              <li key={item.name}>{item.name}: {item.conversions}/{item.leads} → {item.rate}</li>
            ))}
          </ul>

          <h2>🏷️ Top Source Tags (All)</h2>
          <ul>
            {report.sources.map((item: any) => (
              <li key={item.name}>{item.name}: {item.conversions}/{item.leads} → {item.rate}</li>
            ))}
          </ul>

          <h2>📆 Source Breakdown by Lead Year (All Conversions)</h2>
          {report.sourcesByYear.map((block: any) => (
            <div key={block.year} style={{ marginBottom: '1rem' }}>
              <h3>{block.year}</h3>
              <ul>
                {block.sources.map((s: any) => (
                  <li key={s.name}>{s.name}: {s.conversions}/{s.leads} → {s.rate}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
