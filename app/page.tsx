"use client"; // 👈 THIS MUST BE THE FIRST LINE

import { useState } from "react";
import * as XLSX from "xlsx";


export default function Home() {
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [leadsRaw, setLeadsRaw] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const allData: any[] = [];

    for (const file of Array.from(files)) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      allData.push(...json);
    }

    setParsedData(allData);
  };

  const handleLeadsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    setLeadsRaw(json);
  };

  const generateReport = () => {
    if (parsedData.length === 0 || leadsRaw.length === 0) return;

    const hires = parsedData.filter((d) => d.Hired === 1);
    const leads = leadsRaw.map((lead: any) => {
      const created = new Date(lead.lead_created_at);
      return {
        ...lead,
        leadYear: created.getFullYear(),
        email: lead.lead_email.toLowerCase().trim(),
        source: lead.rlp_lead_source || "N/A",
      };
    });

    const leadMap = new Map<string, any>();
    leads.forEach((lead) => {
      leadMap.set(lead.email, lead);
    });

    const results: any[] = [];
    const yearlySummary = new Map<string, { leads: number; conversions: number }>();
    const brokerageStats = new Map<string, { leads: number; conversions: number }>();
    const sourceStats = new Map<string, { leads: number; conversions: number }>();

    hires.forEach((hire: any) => {
      const email = hire["EMail Address"]?.toLowerCase().trim();
      const company = hire["Company Name"] || "Unknown";
      const hireDate = XLSX.SSF.parse_date_code(hire["Hire/Termination Date"]);
      const hireYear = hireDate ? hireDate.y : "N/A";

      const match = leadMap.get(email);
      if (match) {
        const leadYear = match.leadYear.toString();
        const source = match.source;

        results.push({
          name: hire.Agent,
          email,
          company,
          source,
          hireDate: `${hireDate.y}-${hireDate.m}-${hireDate.d}`,
          leadYear,
          gap: `${hireDate.y - match.leadYear} yrs`,
        });

        // update summary by lead year
        const yr = yearlySummary.get(leadYear) || { leads: 0, conversions: 0 };
        yr.leads++;
        yr.conversions++;
        yearlySummary.set(leadYear, yr);

        // update brokerage stats
        const broker = brokerageStats.get(company) || { leads: 0, conversions: 0 };
        broker.leads++;
        broker.conversions++;
        brokerageStats.set(company, broker);

        // update source stats
        const src = sourceStats.get(source) || { leads: 0, conversions: 0 };
        src.leads++;
        src.conversions++;
        sourceStats.set(source, src);
      }
    });

    // add all leads for stats
    leads.forEach((lead) => {
      const leadYear = lead.leadYear.toString();
      const src = lead.rlp_lead_source || "N/A";
      const company = lead.company || "Unknown";

      // update yearlySummary
      const yr = yearlySummary.get(leadYear) || { leads: 0, conversions: 0 };
      yr.leads++;
      yearlySummary.set(leadYear, yr);

      // update source
      const srcStat = sourceStats.get(src) || { leads: 0, conversions: 0 };
      srcStat.leads++;
      sourceStats.set(src, srcStat);

      // update brokerage
      const broker = brokerageStats.get(company) || { leads: 0, conversions: 0 };
      broker.leads++;
      brokerageStats.set(company, broker);
    });

    setReport({
      results,
      yearly: Array.from(yearlySummary.entries()).map(([name, val]) => ({
        name,
        ...val,
        rate: ((val.conversions / val.leads) * 100).toFixed(2) + "%",
      })),
      sources: Array.from(sourceStats.entries()).map(([name, val]) => ({
        name,
        ...val,
        rate: ((val.conversions / val.leads) * 100).toFixed(2) + "%",
      })),
      brokerages: Array.from(brokerageStats.entries()).map(([name, val]) => ({
        name,
        ...val,
        rate: ((val.conversions / val.leads) * 100).toFixed(2) + "%",
      })),
    });
  };

  const downloadCSV = () => {
    if (!report?.results?.length) return;
    const header = ["Name", "Email", "Company", "Source", "Hire Date", "Lead Year", "Gap"];
    const rows = report.results.map((r: any) => [r.name, r.email, r.company, r.source, r.hireDate, r.leadYear, r.gap]);

    const csvContent = [header, ...rows]
      .map((e: (string | number)[]) => e.map((v: string | number) => `"${v}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted_leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem" }}>📊 Growth & Leads File Parser</h1>
      <p>Upload Growth/Attrition Files and a Leads File to generate a detailed report.</p>

      <div style={{ marginTop: "1rem" }}>
        <h2>📂 Upload Growth & Attrition File(s)</h2>
        <input type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleFileUpload} />

        <h2 style={{ marginTop: "1rem" }}>📥 Upload Leads File</h2>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleLeadsUpload} />
      </div>

      <button style={{ marginTop: "1rem", padding: "0.5rem 1rem", fontWeight: "bold", background: "black", color: "white", border: "none", borderRadius: 4 }} onClick={generateReport}>
        ⚡ Generate Report
      </button>

      {report && (
        <section style={{ marginTop: "2rem" }}>
          <h2>🔥 Lead-Year Conversions</h2>
          <ul>
            {report.yearly.map((item: any) => (
              <li key={item.name}>{item.name}: {item.conversions}/{item.leads} → {item.rate}</li>
            ))}
          </ul>

          <h2>🏢 Top Converting Brokerages</h2>
          <ul>
            {report.brokerages
              .filter((b: any) => b.conversions > 0)
              .sort((a: any, b: any) => b.conversions - a.conversions)
              .map((b: any) => (
                <li key={b.name}>{b.name}: {b.conversions}/{b.leads} → {b.rate}</li>
              ))}
          </ul>

          <h2>🏷️ Top Source Tags</h2>
          <ul>
            {report.sources
              .filter((s: any) => s.conversions > 0)
              .sort((a: any, b: any) => b.conversions - a.conversions)
              .map((s: any) => (
                <li key={s.name}>{s.name}: {s.conversions}/{s.leads} → {s.rate}</li>
              ))}
          </ul>

          <button onClick={downloadCSV} style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#0070f3", color: "white", border: "none", borderRadius: 4 }}>
            📥 Download Recruited Agents CSV
          </button>
        </section>
      )}
    </main>
  );
}
