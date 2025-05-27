"use client";

import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function Home() {
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [conversions, setConversions] = useState<any[]>([]);
  const [report, setReport] = useState<any | null>(null);

  // Multi-file support for both growth and leads
  const handleGrowthUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleLeadsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    const files = Array.from(fileList);
    const allLeads: any[] = [];
    files.forEach(async (file) => {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const leads = XLSX.utils.sheet_to_json(worksheet);
      allLeads.push(...leads);
      (window as any).leadsRaw = ((window as any).leadsRaw || []).concat(leads);
      processLeadsAndMatch(parsedData, (window as any).leadsRaw || allLeads);
    });
    // Fallback if leadsRaw not set
    if (!(window as any).leadsRaw) (window as any).leadsRaw = allLeads;
    processLeadsAndMatch(parsedData, allLeads);
  };

  function processLeadsAndMatch(parsedData: any[], leadsRaw: any[]) {
    const leadMap = new Map<string, { source: string; leadYear: string }>();
    leadsRaw.forEach((row: any) => {
      const name = row['lead_name']?.toString().trim();
      const blob = row['lead_text'] || row['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = sourceMatch ? sourceMatch[1].trim().toUpperCase() : 'N/A';
      const dateStr = row['lead_created_at'] || row['created_at'];
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;
      const leadYear = String(date.getFullYear());
      if (name) {
        const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!leadMap.has(normalizedName)) {
          leadMap.set(normalizedName, { source, leadYear });
        }
      }
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
        gap: leadYear ? hireYear - leadYear : 'N/A',
      };
    });
    setParsedData(matched);
    setConversions(matched.filter((m) => m.isConversion));
    (window as any).parsedData = matched;
    (window as any).conversions = matched.filter((m) => m.isConversion);
    (window as any).leadsRaw = leadsRaw;
  }

  // ---------------------- NEW REPORT LOGIC --------------------------
  const generateReport = () => {
    if (parsedData.length === 0 || typeof (window as any).leadsRaw === 'undefined') return;
    const hiresByYear: { [year: string]: any[] } = {};
    parsedData.forEach((row: any) => {
      if (!row.hireYear) return;
      const y = String(row.hireYear);
      if (!hiresByYear[y]) hiresByYear[y] = [];
      hiresByYear[y].push(row);
    });

    const yearly = [];
    const brokeragesByYear = [];
    const sourcesByYear = [];
    const leadsRaw: any[] = (window as any).leadsRaw || [];

    Object.keys(hiresByYear)
      .filter((y) => y && y !== 'null' && !isNaN(Number(y)))
      .sort((a, b) => Number(b) - Number(a))
      .forEach((year) => {
        const hires = hiresByYear[year];

        // Source breakdown for this hire year
        const sourceMap = new Map<string, { conversions: number; leads: number }>();
        // Brokerage breakdown for this hire year
        const brokerageMap = new Map<string, { conversions: number; leads: number }>();

        let yearTotalHires = 0;
        let yearTotalLeads = 0;

        hires.forEach((h) => {
          yearTotalHires++;
          // source
          const src = (h.source || 'N/A').toUpperCase().trim();
          if (!sourceMap.has(src)) sourceMap.set(src, { conversions: 0, leads: 0 });
          sourceMap.get(src)!.conversions += 1;

          // brokerage
          const brokerage = h.company || 'Unknown';
          if (!brokerageMap.has(brokerage)) brokerageMap.set(brokerage, { conversions: 0, leads: 0 });
          brokerageMap.get(brokerage)!.conversions += 1;
        });

        // For each hire, count leads for that agent (by matching name from leadsRaw)
        hires.forEach((h) => {
          const hName = h.agent.toLowerCase().replace(/\s+/g, ' ').trim();
          // find all leads with same lead_name and brokerage
          const agentLeads = leadsRaw.filter((l) => {
            const lName = (l['lead_name'] || '').toLowerCase().replace(/\s+/g, ' ').trim();
            const brokerageLabel = l['accepted_agent_external_label']?.trim() || 'N/A';
            return lName === hName && (brokerageLabel === h.company || !h.company);
          });
          yearTotalLeads += agentLeads.length;
          agentLeads.forEach((lead) => {
            // Count towards agent's source and brokerage
            const blob = lead['lead_text'] || lead['lead_agent_text'] || '';
            const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
            const src = sourceMatch ? sourceMatch[1].trim().toUpperCase() : 'N/A';
            if (sourceMap.has(src)) sourceMap.get(src)!.leads += 1;
            const brokerage = lead['accepted_agent_external_label']?.trim() || 'N/A';
            if (brokerageMap.has(brokerage)) brokerageMap.get(brokerage)!.leads += 1;
          });
        });

        yearly.push({
          name: year,
          conversions: yearTotalHires,
          leads: yearTotalLeads,
          rate: yearTotalLeads > 0 ? ((yearTotalHires / yearTotalLeads) * 100).toFixed(2) + "%" : "0.00%",
        });

        sourcesByYear.push({
          year,
          sources: Array.from(sourceMap.entries())
            .map(([name, data]) => ({
              name,
              conversions: data.conversions,
              leads: data.leads,
              rate: data.leads > 0 ? ((data.conversions / data.leads) * 100).toFixed(2) + "%" : "0.00%",
            }))
            .filter((item) => item.conversions > 0 || item.leads > 0)
            .sort((a, b) => b.conversions - a.conversions || b.leads - a.leads),
        });

        brokeragesByYear.push({
          year,
          brokerages: Array.from(brokerageMap.entries())
            .map(([name, data]) => ({
              name,
              conversions: data.conversions,
              leads: data.leads,
              rate: data.leads > 0 ? ((data.conversions / data.leads) * 100).toFixed(2) + "%" : "0.00%",
            }))
            .filter((item) => item.conversions > 0 || item.leads > 0)
            .sort((a, b) => b.conversions - a.conversions || b.leads - a.leads),
        });
      });

    setReport({
      yearly,
      brokeragesByYear,
      sourcesByYear,
    });
    (window as any).brokeragesByYear = brokeragesByYear;
  };

  // Download converted agents CSV
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

  // Download brokerages by year CSV
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
          <label className="block mb-1 font-medium">Upload Growth Data File(s) (Hires)</label>
          <input type="file" multiple onChange={handleGrowthUpload} className="file-input" />
        </div>
        <div>
          <label className="block mb-1 font-medium">Upload Leads File(s)</label>
          <input type="file" multiple onChange={handleLeadsUpload} className="file-input" />
        </div>
        <button onClick={generateReport} className="btn btn-primary">Generate Report</button>
        <button onClick={downloadCSV} className="btn btn-outline">⬇️ Export CSV</button>
      </div>
      {report && (
        <section className="space-y-8">
          {/* Yearly */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-lg font-semibold mb-2">🎯 Hire-Year Conversions</h2>
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
