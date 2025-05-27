// page.tsx

"use client";

import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function Home() {
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [conversions, setConversions] = useState<any[]>([]);
  const [report, setReport] = useState<any | null>(null);

  // Multi-file upload for growth/hire data
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
          const nameFormatted = nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : nameRaw;

          const date = XLSX.SSF.parse_date_code(dateRaw);
          const yearMonth = `${date.y}-${String(date.m).padStart(2, '0')}`;

          return {
            agent: nameFormatted,
            company,
            date: yearMonth,
            hireYear: date.y,
          };
        })
        .filter(Boolean);

      allCleanedData.push(...cleaned);
    }

    setParsedData(allCleanedData);
    (window as any).parsedData = allCleanedData;
  };

  // Multi-file upload for leads data
  const handleLeadsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;

    const files = Array.from(fileList);
    const allLeads: any[] = [];
    const leadMap = new Map<string, { source: string; leadYear: string }>();
    const leadCountsByYear = new Map<string, number>();
    const sourceYearMatrix = new Map<string, Map<string, number>>();
    const brokerageLeadsByYear = new Map<string, Map<string, number>>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const leads = XLSX.utils.sheet_to_json(worksheet);

      leads.forEach((row: any) => {
        const name = row['lead_name']?.toString().trim();
        const blob = row['lead_text'] || row['lead_agent_text'] || '';
        const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
        const source = sourceMatch ? sourceMatch[1].trim().toUpperCase() : 'N/A';

        const dateStr = row['lead_created_at'] || row['created_at'];
        if (!dateStr) return;
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return;

        const leadYear = String(date.getFullYear());

        // Brokerage Label for tally
        const brokerageLabel = row['accepted_agent_external_label']?.trim() || 'N/A';
        if (!brokerageLeadsByYear.has(leadYear)) brokerageLeadsByYear.set(leadYear, new Map());
        const brokerageMap = brokerageLeadsByYear.get(leadYear)!;
        if (!brokerageMap.has(brokerageLabel)) brokerageMap.set(brokerageLabel, 0);
        brokerageMap.set(brokerageLabel, brokerageMap.get(brokerageLabel)! + 1);

        // Lead counts by year (by lead year, for reference)
        if (!leadCountsByYear.has(leadYear)) leadCountsByYear.set(leadYear, 0);
        leadCountsByYear.set(leadYear, leadCountsByYear.get(leadYear)! + 1);

        // Source-year matrix (for reference)
        if (!sourceYearMatrix.has(leadYear)) sourceYearMatrix.set(leadYear, new Map());
        const yearMap = sourceYearMatrix.get(leadYear)!;
        if (!yearMap.has(source)) yearMap.set(source, 0);
        yearMap.set(source, yearMap.get(source)! + 1);

        // Lead map for name-based lookup
        if (name) {
          const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
          if (!leadMap.has(normalizedName)) {
            leadMap.set(normalizedName, { source, leadYear });
          }
        }

        allLeads.push(row);
      });
    }

    // Map agents to leads
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
        gap: leadYear ? hireYear - leadYear : 'N/A',
      };
    });

    setParsedData(matched);
    setConversions(matched.filter((m) => m.isConversion));
    (window as any).parsedData = matched;
    (window as any).conversions = matched.filter((m) => m.isConversion);
    (window as any).leadsRaw = allLeads;
    (window as any).leadCountsByYear = leadCountsByYear;
    (window as any).sourceYearMatrix = sourceYearMatrix;
    (window as any).brokerageLeadsByYear = brokerageLeadsByYear;
  };

  // Main reporting logic: group by HIRE YEAR for conversions, sources, and brokerages
  const generateReport = () => {
    if (parsedData.length === 0 || typeof (window as any).leadsRaw === 'undefined') return;

    const brokerageLeadsByYear = (window as any).brokerageLeadsByYear as Map<string, Map<string, number>>;

    // Grouping
    const yearly = new Map<string, { leads: number; conversions: number }>();
    const brokeragesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();
    const sourcesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();

    // 1. For each HIRED agent, increment conversions by hireYear/source/brokerage
    parsedData.forEach((row: any) => {
      const hireYear = row.hireYear?.toString() || '';
      if (!hireYear || hireYear === 'null' || isNaN(Number(hireYear))) return;
      const source = (row.source || 'N/A').toUpperCase().trim();
      const brokerage = row.company || 'Unknown';

      // Yearly
      if (!yearly.has(hireYear)) yearly.set(hireYear, { leads: 0, conversions: 0 });
      yearly.get(hireYear)!.conversions += row.isConversion ? 1 : 0;

      // Brokerages
      if (!brokeragesByYear.has(hireYear)) brokeragesByYear.set(hireYear, new Map());
      const yearBrokerages = brokeragesByYear.get(hireYear)!;
      if (!yearBrokerages.has(brokerage)) {
        // Brokerage leads received for this hire year
        let brokerageLeads = 0;
        // Aggregate leads received by brokerage for this hire year
        if (brokerageLeadsByYear.has(hireYear)) {
          brokerageLeads = brokerageLeadsByYear.get(hireYear)?.get(brokerage) || 0;
        }
        yearBrokerages.set(brokerage, { leads: brokerageLeads, conversions: 0 });
      }
      yearBrokerages.get(brokerage)!.conversions += row.isConversion ? 1 : 0;

      // Sources
      if (!sourcesByYear.has(hireYear)) sourcesByYear.set(hireYear, new Map());
      const byYear = sourcesByYear.get(hireYear)!;
      if (!byYear.has(source)) {
        byYear.set(source, { leads: 0, conversions: 0 });
      }
      byYear.get(source)!.conversions += row.isConversion ? 1 : 0;
    });

    // 2. Aggregate LEADS by hire year for sources (from all leads, not just hires)
    // Note: If you want total leads (not just hired), you may need to aggregate from the full leadsRaw list
    const leadsRaw: any[] = (window as any).leadsRaw;
    leadsRaw.forEach((lead: any) => {
      const dateStr = lead['lead_created_at'] || lead['created_at'];
      if (!dateStr) return;
      const leadDate = new Date(dateStr);
      if (isNaN(leadDate.getTime())) return;
      const leadYear = String(leadDate.getFullYear());
      // For all possible hire years in data, assign lead counts
      // For this revision, only hired years will display
      const brokerageLabel = lead['accepted_agent_external_label']?.trim() || 'N/A';
      if (brokeragesByYear.has(leadYear)) {
        const brokeragesMap = brokeragesByYear.get(leadYear)!;
        if (brokeragesMap.has(brokerageLabel)) {
          brokeragesMap.get(brokerageLabel)!.leads += 1;
        }
      }
      // Sources as well
      const blob = lead['lead_text'] || lead['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = sourceMatch ? sourceMatch[1].trim().toUpperCase() : 'N/A';
      if (sourcesByYear.has(leadYear)) {
        const sourcesMap = sourcesByYear.get(leadYear)!;
        if (!sourcesMap.has(source)) sourcesMap.set(source, { leads: 0, conversions: 0 });
        sourcesMap.get(source)!.leads += 1;
      }
      // Yearly total
      if (yearly.has(leadYear)) yearly.get(leadYear)!.leads += 1;
    });

    // Utility: sort
    const sortMap = (map: Map<string, any>) =>
      Array.from(map.entries())
        .map(([name, data]) => ({
          name,
          ...data,
          rate: data.leads > 0 ? ((data.conversions / data.leads) * 100).toFixed(2) + '%' : '0.00%',
        }))
        .filter(item => !!item.name && item.name !== 'N/A' && item.name !== 'null' && !isNaN(Number(item.name)))
        .sort((a, b) => b.conversions - a.conversions || b.leads - a.leads);

    const sortedReport = {
      yearly: sortMap(yearly).sort((a, b) => parseInt(b.name) - parseInt(a.name)),
      brokeragesByYear: Array.from(brokeragesByYear.entries())
        .filter(([year]) => year && year !== 'null' && !isNaN(Number(year)))
        .map(([year, map]) => ({
          year,
          brokerages: sortMap(map),
        }))
        .sort((a, b) => parseInt(b.year) - parseInt(a.year)),
      sourcesByYear: Array.from(sourcesByYear.entries())
        .filter(([year]) => year && year !== 'null' && !isNaN(Number(year)))
        .map(([year, srcMap]) => ({
          year,
          sources: sortMap(srcMap),
        }))
        .sort((a, b) => parseInt(b.year) - parseInt(a.year))
        .filter((block) => block.sources.some(s => s.leads > 0)),
    };

    setReport(sortedReport);
    (window as any).brokeragesByYear = sortedReport.brokeragesByYear;
  };

  // Export for conversions
  const downloadCSV = () => {
    const data = (window as any).conversions || [];
    if (!data.length) return alert("No conversion data to download.");

    const header = [
      'Agent Name', 'Brokerage', 'Hire Date (YYYY-MM)', 'Lead Source', 'Lead Year', 'Hire vs. Lead Gap (yrs)'
    ];

    const rows = data.map((row: any) => [
      row.agent, row.company, row.date, row.source || 'N/A', row.leadYear || 'N/A', row.gap || 'N/A'
    ]);

    const csvContent = [header, ...rows]
      .map((r: (string | number)[]) =>
        r.map((v: string | number) => `"${v}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted_agents.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export for brokerages by year
  const downloadBrokerageReport = () => {
    if (!report || !report.brokeragesByYear?.length) {
      alert("No brokerage data to export.");
      return;
    }

    const header = ["Year", "Brokerage", "Conversions", "Leads", "Rate"];
    const rows: (string | number)[][] = [];

    report.brokeragesByYear
      .filter((block: any) => block.year && block.year !== 'null' && !isNaN(Number(block.year)))
      .forEach((block: any) => {
        const year = block.year;
        block.brokerages.forEach((item: any) => {
          rows.push([year, item.name, item.conversions, item.leads, item.rate]);
        });
      });

    const csvContent = [header, ...rows]
      .map((r: (string | number)[]) => r.map((v: string | number) => `"${v}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "brokerage_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="p-4 md:p-8 max-w-6xl mx-auto text-sm md:text-base">
      <h1 className="text-3xl font-bold mb-6">📊 Growth & Leads File Parser</h1>
      <div className="flex flex-col gap-4 md:flex-row md:items-center mb-8">
        <div>
          <label className="font-semibold block mb-1">Upload Growth/Hire Data</label>
          <input type="file" multiple onChange={handleFileUpload} className="file-input" />
        </div>
        <div>
          <label className="font-semibold block mb-1">Upload Leads File(s)</label>
          <input type="file" multiple onChange={handleLeadsUpload} className="file-input" />
        </div>
        <button onClick={generateReport} className="btn btn-primary">Generate Report</button>
        <button onClick={downloadCSV} className="btn btn-outline">⬇️ Export Conversions CSV</button>
      </div>

      {report && (
        <section className="space-y-8">
          {/* Yearly */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-lg font-semibold mb-2">🎯 Lead-to-Hire Conversions by Hire Year</h2>
            <ul className="list-disc list-inside space-y-1">
              {report.yearly.map((item: any) => (
                <li key={item.name}>{item.name}: {item.conversions}/{item.leads} → {item.rate}</li>
              ))}
            </ul>
          </div>
          {/* Sources */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-lg font-semibold mb-2">📆 Source Breakdown by Hire Year</h2>
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
          {/* Brokerages */}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-semibold">🏢 Brokerages by Year</h2>
              <button onClick={downloadBrokerageReport} className="btn btn-outline">
                ⬇️ Export Brokerages CSV
              </button>
            </div>
            {report.brokeragesByYear.map((block: any) => (
              <details key={block.year} className="mb-4">
                <summary className="cursor-pointer font-medium">{block.year}</summary>
                <table className="table-auto w-full mt-2 border text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-2 py-1">Brokerage</th>
                      <th className="px-2 py-1">Conversions</th>
                      <th className="px-2 py-1">Leads</th>
                      <th className="px-2 py-1">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.brokerages.map((item: any) => (
                      <tr key={item.name} className="border-b">
                        <td className="px-2 py-1">{item.name}</td>
                        <td className="px-2 py-1">{item.conversions}</td>
                        <td className="px-2 py-1">{item.leads}</td>
                        <td className="px-2 py-1">{item.rate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
