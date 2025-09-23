"use client";
import React from "react";
import { useState } from "react";
import * as XLSX from "xlsx";

export default function Home() {
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [conversions, setConversions] = useState<any[]>([]);
  const [report, setReport] = useState<any | null>(null);
  const [openBrokerageSources, setOpenBrokerageSources] = useState<{ [key: string]: boolean }>({});
const [isLoading, setIsLoading] = useState(false);

  const normalizeName = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

  type LeadCandidate = {
    source: string;
    leadYear: string | null;
    leadBrokerage: string;
    leadDate: Date | null;
    raw: any;
  };

  const parseExcelDate = (value: any): Date | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return new Date(parsed.y, parsed.m - 1, parsed.d);
      }
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      const parts = trimmed.split(/[-/]/);
      if (parts.length === 3) {
        const [part1, part2, part3] = parts.map((p) => p.trim());
        // Attempt MM/DD/YYYY fallback when Date parsing fails
        const monthFirst = new Date(`${part1}/${part2}/${part3}`);
        if (!isNaN(monthFirst.getTime())) {
          return monthFirst;
        }
        const isoLike = new Date(`${part1}-${part2}-${part3}`);
        if (!isNaN(isoLike.getTime())) {
          return isoLike;
        }
      }
    }
    return null;
  };

  const parseLeadDate = (value: any): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

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
          const nameRaw = row["Agent"];
          const hired = row["Hired"];
          const company = row["Company Name"];
          const dateRaw = row["Hire/Termination Date"];
          if (!nameRaw || !company || hired !== 1) return null;
          const hireDate = parseExcelDate(dateRaw);
          if (!hireDate) return null;
          const nameParts = nameRaw.split(",").map((s: string) => s.trim());
          const nameFormatted = nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : nameRaw;
          const yearMonth = `${hireDate.getFullYear()}-${String(hireDate.getMonth() + 1).padStart(2, "0")}`;
          return {
            agent: nameFormatted,
            company,
            date: yearMonth,
            hireYear: hireDate.getFullYear(),
            hireDate,
            hireTimestamp: hireDate.getTime(),
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
    for (let file of files) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      allLeads.push(...jsonData);
    }
    const leadMap = new Map<string, LeadCandidate[]>();
    const validLeads: any[] = [];
    const leadCountsByYear = new Map<string, number>();
    const sourceYearMatrix = new Map<string, Map<string, number>>();
    const brokerageLeadsByYear = new Map<string, Map<string, number>>();
    allLeads.forEach((row: any) => {
      const name = row["lead_name"]?.toString().trim();
      const explicitSource = row["rlp_lead_detailed_source"]?.toString().trim();
      const blob = row["lead_text"] || row["lead_agent_text"] || "";
      const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
      const source = (explicitSource || (sourceMatch ? sourceMatch[1] : ""))
        .toString()
        .trim()
        .toUpperCase() || "N/A";
      const dateStr = row["lead_created_at"] || row["created_at"];
      if (!dateStr) return;
      const date = parseLeadDate(dateStr);
      if (!date) return;
      const leadYear = String(date.getFullYear());
      const leadBrokerageLabel = row["accepted_agent_external_label"]?.trim() || "N/A";
      if (!brokerageLeadsByYear.has(leadYear)) brokerageLeadsByYear.set(leadYear, new Map());
      const brokerageMap = brokerageLeadsByYear.get(leadYear)!;
      brokerageMap.set(leadBrokerageLabel, (brokerageMap.get(leadBrokerageLabel) || 0) + 1);
      leadCountsByYear.set(leadYear, (leadCountsByYear.get(leadYear) || 0) + 1);
      if (!sourceYearMatrix.has(leadYear)) sourceYearMatrix.set(leadYear, new Map());
      const yearMap = sourceYearMatrix.get(leadYear)!;
      yearMap.set(source, (yearMap.get(source) || 0) + 1);
      if (name) {
        const normalizedName = normalizeName(name);
        if (!leadMap.has(normalizedName)) {
          leadMap.set(normalizedName, []);
        }
        leadMap.get(normalizedName)!.push({
          source,
          leadYear,
          leadBrokerage: leadBrokerageLabel,
          leadDate: date,
          raw: row,
        });
      }
      validLeads.push(row);
    });
    const selectBestLead = (leads: LeadCandidate[], hireDate: Date | null): LeadCandidate | null => {
      if (!leads.length || !hireDate) return leads.length ? leads[0] : null;
      let best: LeadCandidate | null = null;
      let bestDiff = Infinity;
      for (const lead of leads) {
        if (!lead.leadDate) continue;
        const diff = Math.abs(hireDate.getTime() - lead.leadDate.getTime());
        const isBeforeOrSame = lead.leadDate.getTime() <= hireDate.getTime();
        if (!best) {
          best = lead;
          bestDiff = diff;
          continue;
        }
        const bestBeforeOrSame = best.leadDate ? best.leadDate.getTime() <= hireDate.getTime() : false;
        if (isBeforeOrSame && !bestBeforeOrSame) {
          best = lead;
          bestDiff = diff;
          continue;
        }
        if (isBeforeOrSame === bestBeforeOrSame && diff < bestDiff) {
          best = lead;
          bestDiff = diff;
        }
      }
      return best || (leads.length ? leads[0] : null);
    };

    const matched = parsedData.map((agent) => {
      const name = normalizeName(agent.agent);
      const leadsForAgent = leadMap.get(name) || [];
      const hireDate: Date | null = agent.hireDate instanceof Date
        ? agent.hireDate
        : agent.hireDate
          ? parseExcelDate(agent.hireDate)
          : null;
      const bestLead = selectBestLead(leadsForAgent, hireDate);
      const isBridgemarqLead = (bestLead?.leadBrokerage || "").toLowerCase().includes("bridgemarq");
      const sameBrokerage =
        isBridgemarqLead ||
        (bestLead &&
          agent.company?.toLowerCase().trim() ===
            (bestLead.leadBrokerage || "").toLowerCase().trim());

      let isConversion = false;
      let gapDays: number | null = null;
      if (bestLead?.leadDate && hireDate && sameBrokerage) {
        const diffMs = hireDate.getTime() - bestLead.leadDate.getTime();
        if (diffMs >= 0) {
          isConversion = true;
          gapDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        }
      }

      const leadYear = bestLead?.leadDate
        ? String(bestLead.leadDate.getFullYear())
        : bestLead?.leadYear || null;

      return {
        ...agent,
        isConversion,
        isBridgemarqLead,
        source: bestLead?.source || "N/A",
        leadYear,
        leadBrokerage: bestLead?.leadBrokerage || "N/A",
        leadDate: bestLead?.leadDate ? bestLead.leadDate.toISOString() : null,
        leadTimestamp: bestLead?.leadDate ? bestLead.leadDate.getTime() : null,
        gapDays,
        gap: gapDays !== null ? `${gapDays} days` : "N/A",
      };
    });
    setParsedData(matched);
    setConversions(matched.filter((m) => m.isConversion));
    (window as any).parsedData = matched;
    (window as any).conversions = matched.filter((m) => m.isConversion);
    (window as any).leadsRaw = validLeads;
    (window as any).leadCountsByYear = leadCountsByYear;
    (window as any).sourceYearMatrix = sourceYearMatrix;
    (window as any).brokerageLeadsByYear = brokerageLeadsByYear;
  };

  const toggleBrokerageSources = (year: string, brokerage: string) => {
    setOpenBrokerageSources((prev) => ({
      ...prev,
      [`${year}___${brokerage}`]: !prev[`${year}___${brokerage}`],
    }));
  };

  const generateReport = () => {
    setIsLoading(true);
    setTimeout(() => {
      try {
        if (parsedData.length === 0 || typeof (window as any).leadsRaw === "undefined") return;

        const leadCountsByYearFromWindow =
          ((window as any).leadCountsByYear as Map<string, number>) ||
          new Map<string, number>();
        const sourceYearMatrixFromWindow =
          ((window as any).sourceYearMatrix as Map<string, Map<string, number>>) ||
          new Map<string, Map<string, number>>();

        // --- Yearly Report (by Hire Year) ---
        const hiresAndConversionsByHireYear = new Map<string, { hires: number; conversions: number }>();
        parsedData.forEach((row: any) => {
          const hireYearStr = String(row.hireYear);
          if (!hiresAndConversionsByHireYear.has(hireYearStr)) {
            hiresAndConversionsByHireYear.set(hireYearStr, { hires: 0, conversions: 0 });
          }
          const entry = hiresAndConversionsByHireYear.get(hireYearStr)!;
          entry.hires += 1;
          if (row.isConversion) {
            entry.conversions += 1;
          }
        });
        const yearlyReportMap = new Map<string, { totalHires: number; conversions: number; leads: number }>();
        const allRelevantYears = new Set([
          ...Array.from(hiresAndConversionsByHireYear.keys()),
          ...Array.from(leadCountsByYearFromWindow.keys()),
        ]);
        allRelevantYears.forEach((yearStr) => {
          const hcData = hiresAndConversionsByHireYear.get(yearStr) || { hires: 0, conversions: 0 };
          yearlyReportMap.set(yearStr, {
            totalHires: hcData.hires,
            conversions: hcData.conversions,
            leads: leadCountsByYearFromWindow.get(yearStr) || 0,
          });
        });

        // --- Sources Report (by Hire Year) ---
        const tempSourcesData = new Map<string, Map<string, { conversions: number }>>();
        parsedData.forEach((row: any) => {
          if (row.isConversion) {
            const hireYearStr = String(row.hireYear);
            const source = (row.source || "N/A").toUpperCase().trim();
            if (!tempSourcesData.has(hireYearStr)) {
              tempSourcesData.set(hireYearStr, new Map());
            }
            const hireYearSourceMap = tempSourcesData.get(hireYearStr)!;
            if (!hireYearSourceMap.has(source)) {
              hireYearSourceMap.set(source, { conversions: 0 });
            }
            hireYearSourceMap.get(source)!.conversions += 1;
          }
        });
        const sourcesByHireYearNew = new Map<string, Map<string, { leads: number; conversions: number }>>();
        tempSourcesData.forEach((sourceMap, hireYearStr) => {
          const finalSourceMapForReport = new Map<string, { leads: number; conversions: number }>();
          const sourcesForHireYearFromMatrix = sourceYearMatrixFromWindow.get(hireYearStr) || new Map<string, number>();
          const allPossibleSources = new Set([
            ...Array.from(sourceMap.keys()),
            ...Array.from(sourcesForHireYearFromMatrix.keys()),
          ]);
          allPossibleSources.forEach((source) => {
            const conversions = sourceMap.get(source)?.conversions || 0;
            const leadsInHireYear = sourcesForHireYearFromMatrix.get(source) || 0;
            if (conversions > 0 || leadsInHireYear > 0) {
              finalSourceMapForReport.set(source, {
                leads: leadsInHireYear,
                conversions: conversions,
              });
            }
          });
          if (finalSourceMapForReport.size > 0) {
            sourcesByHireYearNew.set(hireYearStr, finalSourceMapForReport);
          }
        });

        // --- Brokerages Report (by Hire Year) ---
        const brokeragesByHireYearNew = new Map<string, Map<string, { leads: number; conversions: number }>>();
        const brokerageLeadsByYear: Map<string, Map<string, number>> =
          (window as any).brokerageLeadsByYear || new Map();
        const conversionsByHireYearBrokerage = new Map<string, Map<string, number>>();
        parsedData.forEach((row: any) => {
          if (row.isConversion) {
            const hireYearStr = String(row.hireYear);
            const brokerageOfHire = (row.company || "Unknown").trim();
            if (!conversionsByHireYearBrokerage.has(hireYearStr)) {
              conversionsByHireYearBrokerage.set(hireYearStr, new Map());
            }
            const brokerageMap = conversionsByHireYearBrokerage.get(hireYearStr)!;
            brokerageMap.set(brokerageOfHire, (brokerageMap.get(brokerageOfHire) || 0) + 1);
          }
        });
        const allBrokerageYears = new Set<string>([
          ...Array.from(brokerageLeadsByYear.keys()),
          ...Array.from(conversionsByHireYearBrokerage.keys()),
        ]);
        allBrokerageYears.forEach((hireYearStr) => {
          const leadsForYear = brokerageLeadsByYear.get(hireYearStr) || new Map<string, number>();
          const conversionsForYear = conversionsByHireYearBrokerage.get(hireYearStr) || new Map<string, number>();
          const brokerages = new Set<string>([
            ...Array.from(leadsForYear.keys()),
            ...Array.from(conversionsForYear.keys()),
          ]);
          const finalBrokerageMapForReport = new Map<string, { leads: number; conversions: number }>();
          brokerages.forEach((brokerage) => {
            const leadsCount = leadsForYear.get(brokerage) || 0;
            const conversionsCount = conversionsForYear.get(brokerage) || 0;
            finalBrokerageMapForReport.set(brokerage, {
              leads: leadsCount,
              conversions: conversionsCount,
            });
          });
          brokeragesByHireYearNew.set(hireYearStr, finalBrokerageMapForReport);
        });

        // --- Source breakdown within brokerages ---
        const brokerageSourceBreakdownByHireYear = new Map();
        const allLeadsRaw = (window as any).leadsRaw || [];
        allBrokerageYears.forEach((hireYearStr) => {
          const perBrokerage = new Map();
          const brokeragesMap = brokeragesByHireYearNew.get(hireYearStr);
          const brokerages = brokeragesMap ? Array.from(brokeragesMap.keys()) : [];
          brokerages.forEach((brokerage) => {
            const leads = allLeadsRaw.filter(
              (row: any) =>
                String(new Date(row["lead_created_at"] || row["created_at"]).getFullYear()) === hireYearStr &&
                (row["accepted_agent_external_label"]?.trim() || "N/A") === brokerage
            );
            const leadsBySource: { [key: string]: any[] } = {};
            leads.forEach((row: any) => {
              const explicitSource = row["rlp_lead_detailed_source"]?.toString().trim();
              const blob = row["lead_text"] || row["lead_agent_text"] || "";
              const sourceMatch = blob.match(/source:\s*([^\n]+)/i);
              const source = (explicitSource || (sourceMatch ? sourceMatch[1] : "") || "")
                .toString()
                .trim()
                .toUpperCase() || "N/A";
              if (!leadsBySource[source]) leadsBySource[source] = [];
              leadsBySource[source].push(row);
            });
            const conversions = parsedData.filter(
              (row: any) =>
                row.isConversion &&
                String(row.hireYear) === hireYearStr &&
                (row.company || "Unknown").trim() === brokerage
            );
            const conversionsBySource: { [key: string]: number } = {};
            conversions.forEach((row: any) => {
              const source = (row.source || "N/A").toUpperCase();
              if (!conversionsBySource[source]) conversionsBySource[source] = 0;
              conversionsBySource[source]++;
            });
            const sources = new Set([
              ...Object.keys(leadsBySource),
              ...Object.keys(conversionsBySource),
            ]);
            const sourceList = Array.from(sources)
              .map((source) => {
                const leadsCount = (leadsBySource[source] || []).length;
                const conversionsCount = conversionsBySource[source] || 0;
                return {
                  source,
                  leads: leadsCount,
                  conversions: conversionsCount,
                  rate:
                    leadsCount > 0
                      ? ((conversionsCount / leadsCount) * 100).toFixed(2) + "%"
                      : "0.00%",
                };
              })
              .sort((a, b) => b.conversions - a.conversions || b.leads - a.leads);
            perBrokerage.set(brokerage, sourceList);
          });
          brokerageSourceBreakdownByHireYear.set(hireYearStr, perBrokerage);
        });

        const leadTotalsByYear = Array.from(leadCountsByYearFromWindow.entries())
          .map(([year, leads]) => ({ year, leads }))
          .filter((entry) => entry.year && entry.year !== "null" && !isNaN(Number(entry.year)))
          .sort((a, b) => parseInt(b.year) - parseInt(a.year));

        const leadSourcesByYear = Array.from(sourceYearMatrixFromWindow.entries())
          .map(([year, srcMap]) => ({
            year,
            sources: Array.from(srcMap.entries())
              .map(([source, leads]) => ({ name: source, leads }))
              .filter((item) => item.leads > 0)
              .sort((a, b) => b.leads - a.leads),
          }))
          .filter((block) =>
            block.year &&
            block.year !== "null" &&
            !isNaN(Number(block.year)) &&
            block.sources.length > 0
          )
          .sort((a, b) => parseInt(b.year) - parseInt(a.year));

        const leadBrokeragesByYearSummary = Array.from(brokerageLeadsByYear.entries())
          .map(([year, brokerageMap]) => ({
            year,
            brokerages: Array.from(brokerageMap.entries())
              .map(([brokerage, leads]) => ({ name: brokerage, leads }))
              .filter((item) => item.leads > 0)
              .sort((a, b) => b.leads - a.leads),
          }))
          .filter((block) =>
            block.year &&
            block.year !== "null" &&
            !isNaN(Number(block.year)) &&
            block.brokerages.length > 0
          )
          .sort((a, b) => parseInt(b.year) - parseInt(a.year));

        const sortMap = (map: Map<string, any>) =>
          Array.from(map.entries())
            .map(([name, data]) => ({
              name,
              ...data,
              rate:
                data.leads > 0
                  ? ((data.conversions / data.leads) * 100).toFixed(2) + "%"
                  : data.totalHires > 0 && Object.prototype.hasOwnProperty.call(data, "totalHires")
                    ? ((data.conversions / data.totalHires) * 100).toFixed(2) + "%"
                    : "0.00%",
            }))
            .filter(
              (item) =>
                !(
                  item.name === "N/A" &&
                  item.leads === 0 &&
                  (item.totalHires === undefined || item.totalHires === 0) &&
                  item.conversions === 0
                )
            )
            .sort(
              (a, b) =>
                b.conversions - a.conversions ||
                (b.leads || b.totalHires || 0) -
                  (a.leads || a.totalHires || 0)
            );

        const sortedReport = {
          yearly: sortMap(yearlyReportMap).sort(
            (a, b) => parseInt(b.name) - parseInt(a.name)
          ),
          brokeragesByYear: Array.from(brokeragesByHireYearNew.entries())
            .filter(([year]) => year && year !== "null" && !isNaN(Number(year)))
            .map(([year, map]) => ({
              year,
              brokerages: sortMap(map),
            }))
            .sort((a, b) => parseInt(b.year) - parseInt(a.year)),
          sourcesByYear: Array.from(sourcesByHireYearNew.entries())
            .map(([year, srcMap]) => ({
              year,
              sources: sortMap(srcMap),
            }))
            .sort((a, b) => parseInt(b.year) - parseInt(a.year))
            .filter(
              (block) =>
                block.year &&
                block.year !== "null" &&
                !isNaN(Number(block.year)) &&
                block.sources.some((s) => s.leads > 0 || s.conversions > 0)
            ),
          brokerageSourceBreakdownByHireYear,
          leadSummary: {
            totalsByYear: leadTotalsByYear,
            sourcesByYear: leadSourcesByYear,
            brokeragesByYear: leadBrokeragesByYearSummary,
          },
        };

        setReport(sortedReport);
        (window as any).brokeragesByYear = sortedReport.brokeragesByYear;
        (window as any).leadSummary = sortedReport.leadSummary;
      } finally {
        setIsLoading(false);
      }
    }, 0);
  };

  const downloadCSV = () => {
    const data = (window as any).conversions || [];
    if (!data.length) return alert("No conversion data to download.");
    const header = [
      "Agent Name",
      "Brokerage (Hired)",
      "Hire Date (YYYY-MM)",
      "Lead Source",
      "Lead Year",
      "Lead Brokerage",
      "Hire vs. Lead Gap (yrs)",
    ];
    const rows = data.map((row: any) => [
      row.agent,
      row.company,
      row.date,
      row.source || "N/A",
      row.leadYear || "N/A",
      row.leadBrokerage || "N/A",
      row.gap ?? "N/A",
    ]);
    const csvContent = [header, ...rows]
      .map((r: (string | number)[]) =>
        r.map((v: string | number) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "conversions_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadBrokerageReport = () => {
    if (!report || !report.brokeragesByYear?.length) {
      alert("No brokerage data to export.");
      return;
    }
    const header = [
      "Hire Year",
      "Brokerage (Hired)",
      "Conversions",
      "Total Leads Involved",
      "Rate",
    ];
    const rows: (string | number)[][] = [];
    report.brokeragesByYear
      .filter(
        (block: any) =>
          block.year && block.year !== "null" && !isNaN(Number(block.year))
      )
      .forEach((block: any) => {
        const year = block.year;
        block.brokerages.forEach((item: any) => {
          rows.push([
            year,
            item.name,
            item.conversions,
            item.leads,
            item.rate,
          ]);
        });
      });
    const csvContent = [header, ...rows]
      .map((r: (string | number)[]) =>
        r.map((v: string | number) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "brokerage_by_hire_year_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

 return (
    <main className="p-4 md:p-8 max-w-6xl mx-auto text-sm md:text-base">
      <h1 className="text-3xl font-bold mb-6">
        📊 Growth & Leads File Parser
      </h1>
      <div className="flex flex-col gap-4 md:flex-row md:items-center mb-8">
        <div className="flex flex-col">
          <label className="font-medium mb-1">
            📂 Upload Growth Files (Hires)
          </label>
          <input
            type="file"
            multiple
            onChange={handleFileUpload}
            className="file-input"
          />
        </div>
        <div className="flex flex-col">
          <label className="font-medium mb-1">
            📂 Upload Leads Files
          </label>
          <input
            type="file"
            multiple
            onChange={handleLeadsUpload}
            className="file-input"
          />
        </div>
        <button
          onClick={generateReport}
          className="btn btn-primary"
          disabled={isLoading}
        >
          Generate Report
        </button>
        <button
          onClick={downloadCSV}
          className="btn btn-outline"
        >
          ⬇️ Export Conversions CSV
        </button>
      </div>

      {/* Spinner appears while loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <svg className="animate-spin h-8 w-8 mr-3 text-blue-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-lg font-medium text-blue-800">Generating report, please wait…</span>
        </div>
      )}

      {/* Report UI renders only when not loading */}
      {!isLoading && report && (
        <section className="space-y-8">
          {/* Yearly */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-lg font-semibold mb-2">
              🎯 Hire-Year Conversion Summary
            </h2>
            <ul className="list-disc list-inside space-y-1">
              {report.yearly.map((item: any) => (
                <li key={item.name}>
                  {item.name} (Hire Year): {item.conversions} Conv. / {item.leads} Leads ({item.totalHires} Total Hires) → {item.rate}
                </li>
              ))}
            </ul>
          </div>

          {/* Sources */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-lg font-semibold mb-2">
              📆 Source Breakdown by Hire Year (All Conversions)
            </h2>
            {report.sourcesByYear.map((block: any) => (
              <div key={block.year} className="mb-4">
                <h3 className="text-base font-medium mb-1">
                  Hire Year: {block.year}
                </h3>
                <ul className="list-disc list-inside space-y-1">
                  {block.sources.map((s: any) => (
                    <li key={s.name}>
                      {s.name}: {s.conversions} Conv. / {s.leads} Leads → {s.rate}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Brokerages */}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-semibold">
                🏢 Brokerages by Hire Year
              </h2>
              <button
                onClick={downloadBrokerageReport}
                className="btn btn-outline"
              >
                ⬇️ Export Brokerages CSV
              </button>
            </div>
            {report.brokeragesByYear.map((block: any) => (
              <details
                key={block.year}
                className="mb-4"
              >
                <summary className="cursor-pointer font-medium">
                  Hire Year: {block.year}
                </summary>
                <table className="table-auto w-full mt-2 border text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-2 py-1">Brokerage (Hired)</th>
                      <th className="px-2 py-1">Conversions</th>
                      <th className="px-2 py-1">Total Leads Involved</th>
                      <th className="px-2 py-1">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.brokerages.map((item: any) => (
                      <React.Fragment key={item.name}>
                        <tr className="border-b">
                          <td className="px-2 py-1">
                            <button
                              className="font-bold text-blue-600 underline"
                              onClick={() => toggleBrokerageSources(block.year, item.name)}
                              type="button"
                            >
                              {openBrokerageSources[`${block.year}___${item.name}`] ? "▼" : "▶"} {item.name}
                            </button>
                          </td>
                          <td className="px-2 py-1">{item.conversions}</td>
                          <td className="px-2 py-1">{item.leads}</td>
                          <td className="px-2 py-1">{item.rate}</td>
                        </tr>
                        {openBrokerageSources[`${block.year}___${item.name}`] && (
                          <tr>
                            <td colSpan={4} className="bg-gray-50 px-4 py-2">
                              <div>
                                <strong>Source Breakdown:</strong>
                                <table className="w-full text-xs mt-2">
                                  <thead>
                                    <tr>
                                      <th className="text-left px-2">Source</th>
                                      <th className="text-left px-2">Leads</th>
                                      <th className="text-left px-2">Conversions</th>
                                      <th className="text-left px-2">Rate</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(report.brokerageSourceBreakdownByHireYear.get(block.year)?.get(item.name) || []).map((src: any) => (
                                      <tr key={src.source}>
                                        <td className="px-2">{src.source}</td>
                                        <td className="px-2">{src.leads}</td>
                                        <td className="px-2">{src.conversions}</td>
                                        <td className="px-2">{src.rate}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>

          {/* Lead Assignments */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-lg font-semibold mb-2">
              📈 Lead Assignments (Lead Year)
            </h2>

            {report.leadSummary?.totalsByYear?.length ? (
              <div className="mb-4">
                <h3 className="text-base font-medium mb-1">Lead Volume</h3>
                <ul className="list-disc list-inside space-y-1">
                  {report.leadSummary.totalsByYear.map((item: any) => (
                    <li key={item.year}>
                      {item.year}: {item.leads} Leads Assigned
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {report.leadSummary?.sourcesByYear?.length ? (
              <div className="mb-4">
                <h3 className="text-base font-medium mb-1">Sources</h3>
                {report.leadSummary.sourcesByYear.map((block: any) => (
                  <div key={block.year} className="mb-2">
                    <h4 className="font-medium">Lead Year: {block.year}</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {block.sources.map((item: any) => (
                        <li key={item.name}>
                          {item.name}: {item.leads} Leads
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}

            {report.leadSummary?.brokeragesByYear?.length ? (
              <div>
                <h3 className="text-base font-medium mb-1">Brokerages</h3>
                {report.leadSummary.brokeragesByYear.map((block: any) => (
                  <div key={block.year} className="mb-2">
                    <h4 className="font-medium">Lead Year: {block.year}</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {block.brokerages.map((item: any) => (
                        <li key={item.name}>
                          {item.name}: {item.leads} Leads
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No lead assignments available.</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
