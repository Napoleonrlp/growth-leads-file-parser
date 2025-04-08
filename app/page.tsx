"use client";

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
            hireYear: date.y
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
    const sourceYearMatrix = new Map<string, Map<string, number>>();

    leads.forEach((row: any) => {
      const name = row['lead_name']?.toString().trim();
      const blob = row['lead_text'] || row['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = (sourceMatch ? sourceMatch[1].trim() : 'Unknown') || 'N/A';

      const dateStr = row['lead_created_at'] || row['created_at'];
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;

      const leadYear = String(date.getFullYear());

      // ✅ Count all valid leads (even if no name)
      if (!leadCountsByYear.has(leadYear)) leadCountsByYear.set(leadYear, 0);
      leadCountsByYear.set(leadYear, leadCountsByYear.get(leadYear)! + 1);

      if (!sourceYearMatrix.has(leadYear)) sourceYearMatrix.set(leadYear, new Map());
      const yearMap = sourceYearMatrix.get(leadYear)!;
      if (!yearMap.has(source)) yearMap.set(source, 0);
      yearMap.set(source, yearMap.get(source)! + 1);

      if (name) {
        const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!leadMap.has(normalizedName)) {
          leadMap.set(normalizedName, { source, leadYear });
        }
      }

      validLeads.push(row);
    });

    const matched = parsedData.map((agent) => {
      const name = agent.agent.toLowerCase().replace(/\s+/g, ' ').trim();
      const match = leadMap.get(name);
      const hireYear = parseInt(agent.hireYear);
      const leadYear = match?.leadYear ? parseInt(match.leadYear) : null;

      return {
        ...agent,
        isConversion: !!match && hireYear >= (leadYear || 0),
        source: match?.source || 'N/A',
        leadYear: match?.leadYear || null,
        gap: leadYear ? hireYear - leadYear : 'N/A'
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
    // @ts-ignore
    window.sourceYearMatrix = sourceYearMatrix;
  };

  return (
    <main className="p-4 md:p-8 max-w-6xl mx-auto text-sm md:text-base">
      <h1 className="text-3xl font-bold mb-6">📊 Growth & Leads File Parser</h1>

      <div className="flex flex-col gap-4 md:flex-row md:items-center mb-8">
        <input type="file" multiple onChange={handleFileUpload} className="file-input" />
        <input type="file" onChange={handleLeadsUpload} className="file-input" />
        <button onClick={() => generateReport()} className="btn btn-primary">Generate Report</button>
        <button onClick={() => downloadCSV()} className="btn btn-outline">⬇️ Export CSV</button>
      </div>

      {report && (
        <section className="space-y-8">
          {[{
            title: "🎯 Lead-Year Conversions",
            data: report.yearly
          }, {
            title: "🏢 Top Converting Brokerages",
            data: report.brokerages
          }, {
            title: "🏷️ Top Source Tags (All)",
            data: report.sources
          }].map((section) => (
            <div key={section.title} className="bg-white rounded-xl shadow p-5">
              <h2 className="text-lg font-semibold mb-2">{section.title}</h2>
              <ul className="list-disc list-inside space-y-1">
                {section.data.map((item: any) => (
                  <li key={item.name}>{item.name}: {item.conversions}/{item.leads} → {item.rate}</li>
                ))}
              </ul>
            </div>
          ))}

          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-lg font-semibold mb-2">📆 Source Breakdown by Lead Year (All Conversions)</h2>
            {report.sourcesByYear.map((block: any) => (
              <div key={block.year} className="mb-4">
                <h3 className="text-base font-medium mb-1">{block.year}</h3>
                <ul className="list-disc list-inside space-y-1">
                  {block.sources.map((s: any) => (
                    <li key={s.name}>{s.name}: {s.conversions}/{s.leads} → {s.rate}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
