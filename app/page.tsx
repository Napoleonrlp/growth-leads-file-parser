'use client';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';

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

      if (!leadCountsByYear.has(leadYear)) leadCountsByYear.set(leadYear, 0);
      leadCountsByYear.set(leadYear, leadCountsByYear.get(leadYear)! + 1);

      if (!sourceYearMatrix.has(leadYear)) sourceYearMatrix.set(leadYear, new Map());
      const yearMap = sourceYearMatrix.get(leadYear)!;
      if (!yearMap.has(source)) yearMap.set(source, 0);
      yearMap.set(source, yearMap.get(source)! + 1);

      if (name) {
        validLeads.push(row);
        const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
        leadMap.set(normalizedName, { source, leadYear });
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
        gap: leadYear ? hireYear - leadYear : 'N/A'
      };
    });

    setParsedData(matched);
    setConversions(matched.filter((m) => m.isConversion));
    window.parsedData = matched;
    window.conversions = matched.filter((m) => m.isConversion);
    window.leadsRaw = validLeads;
    window.leadCountsByYear = leadCountsByYear;
    window.sourceYearMatrix = sourceYearMatrix;

    generateReport(matched, validLeads);
  };

  const generateReport = (data: any[], leads: any[]) => {
    const yearly = new Map<string, { leads: number; conversions: number }>();
    const leadOnlyYear = new Map<string, number>();
    const brokerages = new Map<string, { leads: number; conversions: number }>();
    const sources = new Map<string, { leads: number; conversions: number }>();
    const sourcesByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();
    const brokersByYear = new Map<string, Map<string, { leads: number; conversions: number }>>();

    leads.forEach((row: any) => {
      const name = row['lead_name']?.toString().trim().toLowerCase();
      const blob = row['lead_text'] || row['lead_agent_text'] || '';
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = (sourceMatch ? sourceMatch[1].trim() : 'Unknown') || 'N/A';

      const dateStr = row['lead_created_at'] || row['created_at'];
      const year = dateStr ? new Date(dateStr).getFullYear().toString() : 'N/A';

      if (!leadOnlyYear.has(year)) leadOnlyYear.set(year, 0);
      leadOnlyYear.set(year, leadOnlyYear.get(year)! + 1);

      if (!sourcesByYear.has(year)) sourcesByYear.set(year, new Map());
      const yearMap = sourcesByYear.get(year)!;
      if (!yearMap.has(source)) yearMap.set(source, { leads: 0, conversions: 0 });
      yearMap.get(source)!.leads += 1;
    });

    data.forEach((item) => {
      const { hireYear, leadYear, isConversion, company, source } = item;

      if (!yearly.has(hireYear)) yearly.set(hireYear, { leads: 0, conversions: 0 });
      yearly.get(hireYear)!.leads++;
      if (isConversion) yearly.get(hireYear)!.conversions++;

      if (leadYear && !leadOnlyYear.has(leadYear)) leadOnlyYear.set(leadYear, 0);

      if (!brokerages.has(company)) brokerages.set(company, { leads: 0, conversions: 0 });
      brokerages.get(company)!.leads++;
      if (isConversion) brokerages.get(company)!.conversions++;

      if (!sources.has(source)) sources.set(source, { leads: 0, conversions: 0 });
      sources.get(source)!.leads++;
      if (isConversion) sources.get(source)!.conversions++;

      if (leadYear) {
        if (!sourcesByYear.has(leadYear)) sourcesByYear.set(leadYear, new Map());
        const yearMap = sourcesByYear.get(leadYear)!;
        if (!yearMap.has(source)) yearMap.set(source, { leads: 0, conversions: 0 });
        if (isConversion) yearMap.get(source)!.conversions++;

        if (!brokersByYear.has(hireYear)) brokersByYear.set(hireYear, new Map());
        const brokerYearMap = brokersByYear.get(hireYear)!;
        if (!brokerYearMap.has(company)) brokerYearMap.set(company, { leads: 0, conversions: 0 });
        brokerYearMap.get(company)!.leads++;
        if (isConversion) brokerYearMap.get(company)!.conversions++;
      }
    });

    const format = (map: Map<string, any>) =>
      [...map.entries()].map(([name, val]) => ({
        name,
        ...val,
        rate: val.leads > 0 ? `${((val.conversions / val.leads) * 100).toFixed(2)}%` : '0.00%'
      })).sort((a, b) => b.conversions - a.conversions);

    const formattedSourcesByYear = [...sourcesByYear.entries()].map(([year, sourceMap]) => ({
      year,
      sources: format(sourceMap)
    }));

    const formattedBrokersByYear = [...brokersByYear.entries()].map(([year, brokerMap]) => ({
      year,
      brokers: format(brokerMap)
    }));

    setReport({
      yearly: format(yearly),
      leadOnlyYear: format(leadOnlyYear),
      brokerages: format(brokerages),
      sources: format(sources),
      sourcesByYear: formattedSourcesByYear,
      brokersByYear: formattedBrokersByYear
    });
  };

  const downloadCSV = () => {
    const data: any[] = window.conversions || [];
    if (!data.length) return alert("No conversion data to download.");

    const header = ['Agent Name', 'Brokerage', 'Hire Date (YYYY-MM)', 'Lead Source', 'Lead Year', 'Hire vs. Lead Gap (yrs)'];
    const rows = data.map((row: any) => [
      row.agent,
      row.company,
      row.date,
      row.source || 'N/A',
      row.leadYear || 'N/A',
      row.gap || 'N/A'
    ]);

    const csvContent = [header, ...rows]
      .map((e: any[]) => e.map((v: any) => `"${v}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted_agents.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">📊 Growth & Leads File Parser</h1>
      <input type="file" multiple onChange={handleFileUpload} className="mb-2" />
      <input type="file" onChange={handleLeadsUpload} className="mb-2" />
      <Button onClick={() => generateReport(parsedData, window.leadsRaw)}>Generate Report</Button>
      <Button onClick={downloadCSV} className="ml-2">⬇️ Download CSV</Button>

      {report && (
        <>
          <h2 className="text-xl font-semibold mt-6">📆 Conversions by Year & Source</h2>
          <ul className="list-disc ml-6">
            {report.yearly.map((y: any) => (
              <li key={y.name}>{y.name}: {y.conversions}/{y.leads} → {y.rate}</li>
            ))}
          </ul>

          <h2 className="text-xl font-semibold mt-6">🏢 Top Converting Brokerages by Year</h2>
          <Accordion type="single" collapsible className="w-full">
            {report.brokersByYear.map((block: any) => (
              <AccordionItem key={block.year} value={block.year}>
                <div className="p-4">
                  <h3 className="text-lg font-semibold">📅 {block.year}</h3>
                  {block.brokers.map((b: any) => (
                    <div key={b.name} className="border-b py-2">
                      <p className="font-medium">{b.name}</p>
                      <p className="text-sm">Leads: {b.leads}, Conversions: {b.conversions}, Rate: {b.rate}</p>
                    </div>
                  ))}
                </div>
              </AccordionItem>
            ))}
          </Accordion>
        </>
      )}
    </div>
  );
}
