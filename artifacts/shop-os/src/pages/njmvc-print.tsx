import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";

async function apiFetch(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const VEHICLE_TYPES = ["A", "B", "C", "D", "SV"];

interface ItemResult {
  status: string | null;
  repairedDate: string | null;
  measurementValue: string | null;
  notes: string | null;
}

interface TemplateItem {
  id: number;
  label: string;
  active: boolean;
  hasMeasurement: boolean;
  measurementUnit: string | null;
  result: ItemResult | null;
}

interface TemplateCategory {
  id: number;
  name: string;
  active: boolean;
  items: TemplateItem[];
}

interface InspectionVehicle {
  year: string | null;
  make: string | null;
  model: string | null;
}

interface FullInspection {
  id: number;
  vehicleId: number;
  vehicle: InspectionVehicle | null;
  operatorName: string | null;
  address: string | null;
  mechanicNamePrint: string | null;
  mechanicNameSigned: string | null;
  reportNumber: string | null;
  fleetUnitNumber: string | null;
  mileage: number | null;
  vehicleType: string | null;
  vin: string | null;
  licensePlate: string | null;
  inspectionDate: string | null;
  certifiedPassed: boolean;
  notes: string | null;
  createdAt: string;
  template: TemplateCategory[];
}

interface RelatedRepair {
  id: number;
  orderNumber: string;
  complaint: string | null;
  diagnosis: string | null;
  status: string;
  completedAt: string | null;
  createdAt: string;
  technician: string | null;
}

interface RelatedRepairsResponse {
  repairOrders: RelatedRepair[];
}

interface PrintSection {
  catName: string;
  items: TemplateItem[];
}

const BORDER = "1px solid #000";
const CAT_BG = "#b0b0b0";
const SUB_HDR_BG = "#d8d8d8";

export default function NjmvcPrint() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  const { data: insp, isLoading } = useQuery<FullInspection>({
    queryKey: ["/api/njmvc/inspections", id],
    queryFn: () => apiFetch(`/api/njmvc/inspections/${id}`),
  });

  const { data: relatedData } = useQuery<RelatedRepairsResponse>({
    queryKey: ["/api/njmvc/inspections", id, "related-repairs"],
    queryFn: () => apiFetch(`/api/njmvc/inspections/${id}/related-repairs`),
  });
  const relatedRepairs = relatedData?.repairOrders || [];

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading inspection...</div>;
  }
  if (!insp) {
    return <div className="p-8 text-center text-muted-foreground">Inspection not found.</div>;
  }

  const resultMap: Record<number, ItemResult | null> = {};
  insp.template?.forEach(cat => {
    cat.items?.forEach(item => { resultMap[item.id] = item.result; });
  });

  const activeCategories = (insp.template || []).filter(c => c.active);
  const allSections: PrintSection[] = activeCategories.map(cat => ({
    catName: cat.name,
    items: cat.items?.filter(i => i.active) || [],
  }));

  const col1 = allSections.filter((_, i) => i < 7);
  const col2 = allSections.filter((_, i) => i >= 7 && i < 14);
  const col3 = allSections.filter((_, i) => i >= 14);

  function renderSection(section: PrintSection) {
    return (
      <table key={section.catName} style={{ width: "100%", borderCollapse: "collapse", marginBottom: 3, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 15 }} />
          <col style={{ width: 15 }} />
          <col style={{ width: 34 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={4} style={{
              background: CAT_BG,
              border: BORDER,
              fontSize: 7,
              fontWeight: "bold",
              textTransform: "uppercase",
              textAlign: "left",
              padding: "1px 3px",
              letterSpacing: "0.03em",
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            } as React.CSSProperties}>
              {section.catName}
            </th>
          </tr>
          <tr>
            <th style={{ background: SUB_HDR_BG, borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER, fontSize: 6, textAlign: "center", padding: "1px", fontWeight: "bold", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>OK/NA</th>
            <th style={{ background: SUB_HDR_BG, borderRight: BORDER, borderBottom: BORDER, fontSize: 6, textAlign: "center", padding: "1px", fontWeight: "bold", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>NR</th>
            <th style={{ background: SUB_HDR_BG, borderRight: BORDER, borderBottom: BORDER, fontSize: 6, textAlign: "center", padding: "1px", fontWeight: "bold", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>DATE REP.</th>
            <th style={{ background: SUB_HDR_BG, borderRight: BORDER, borderBottom: BORDER, fontSize: 6, textAlign: "left", padding: "1px 2px", fontWeight: "bold", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>ITEM</th>
          </tr>
        </thead>
        <tbody>
          {section.items.map(item => {
            const r = resultMap[item.id];
            const status = r?.status || null;
            return (
              <tr key={item.id}>
                <td style={{ borderLeft: BORDER, borderRight: BORDER, textAlign: "center", padding: "0px 1px", verticalAlign: "middle", height: 11 }}>
                  {status === "ok" && <span style={{ fontSize: 9, fontWeight: "bold", lineHeight: 1 }}>✔</span>}
                  {status === "na" && <span style={{ fontSize: 6, fontWeight: "bold", lineHeight: 1 }}>NA</span>}
                </td>
                <td style={{ borderRight: BORDER, textAlign: "center", padding: "0px 1px", verticalAlign: "middle" }}>
                  {status === "needs_repair" && <span style={{ fontSize: 9, fontWeight: "bold", lineHeight: 1 }}>✔</span>}
                </td>
                <td style={{ borderRight: BORDER, textAlign: "center", fontSize: 6, padding: "0px 1px", verticalAlign: "middle" }}>
                  {status === "needs_repair" && r?.repairedDate ? r.repairedDate.slice(5) : ""}
                </td>
                <td style={{ borderRight: BORDER, fontSize: 7, padding: "0px 2px", verticalAlign: "middle" }}>
                  {item.label}
                  {item.hasMeasurement && (
                    <span style={{ fontSize: 6, color: "#444", marginLeft: 2 }}>
                      {r?.measurementValue ? `${r.measurementValue}${item.measurementUnit}` : `___${item.measurementUnit}`}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={4} style={{ borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER, height: 1, padding: 0 }} />
          </tr>
        </tbody>
      </table>
    );
  }

  const inspDateStr = insp.inspectionDate
    ? new Date(insp.inspectionDate + "T00:00:00").toLocaleDateString()
    : new Date(insp.createdAt).toLocaleDateString();

  return (
    <>
      {/* Screen toolbar — hidden during print */}
      <div className="print:hidden flex items-center gap-3 p-4 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/njmvc/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-bold text-lg">Print NJMVC Inspection Report</h1>
          <p className="text-sm text-muted-foreground">
            {insp.vehicle?.year} {insp.vehicle?.make} {insp.vehicle?.model} · {inspDateStr}
          </p>
        </div>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" /> Print / Save PDF
        </Button>
      </div>

      {/* ── PRINT CONTENT ─────────────────────────────────────────── */}
      <div id="njmvc-print-content" style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        padding: "6mm 8mm",
        background: "#fff",
        color: "#000",
        fontSize: 8,
      }}>

        {/* ── TITLE ROW ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 3 }}>
          <tbody>
            <tr>
              <td style={{ border: BORDER, padding: "3px 6px", background: CAT_BG, verticalAlign: "middle", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>
                <div style={{ fontWeight: "bold", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  State of New Jersey — Motor Vehicle Commission
                </div>
                <div style={{ fontWeight: "bold", fontSize: 8, textTransform: "uppercase" }}>
                  Quarterly Vehicle Inspection Report
                </div>
              </td>
              <td style={{ border: BORDER, padding: "2px 5px", width: "22%", verticalAlign: "middle" }}>
                <div style={{ fontSize: 6.5, fontWeight: "bold" }}>REPORT #</div>
                <div style={{ fontSize: 9, fontWeight: "bold", minHeight: 12 }}>{insp.reportNumber || ""}</div>
                <div style={{ fontSize: 6.5, fontWeight: "bold", marginTop: 2 }}>FLEET UNIT #</div>
                <div style={{ fontSize: 9, fontWeight: "bold", minHeight: 12 }}>{insp.fleetUnitNumber || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── OPERATOR / MECHANIC HEADER ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 3 }}>
          <tbody>
            <tr>
              <td style={{ border: BORDER, padding: "1px 3px", width: "38%", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>OPERATOR</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{insp.operatorName || ""}</div>
              </td>
              <td style={{ border: BORDER, padding: "1px 3px", width: "16%", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>MILES</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{insp.mileage ? insp.mileage.toLocaleString() : ""}</div>
              </td>
              <td style={{ border: BORDER, padding: "1px 3px", width: "16%", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>DATE</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{inspDateStr}</div>
              </td>
              <td style={{ border: BORDER, padding: "1px 3px", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>MECHANIC NAME (Print or Type)</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{insp.mechanicNamePrint || ""}</div>
              </td>
            </tr>
            <tr>
              <td style={{ border: BORDER, padding: "1px 3px", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>ADDRESS</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{insp.address || ""}</div>
              </td>
              <td colSpan={2} style={{ border: BORDER, padding: "1px 3px", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>VEHICLE TYPE (Circle One)</div>
                <div style={{ padding: "1px 0", fontSize: 9 }}>
                  {VEHICLE_TYPES.map(t => (
                    <span key={t} style={{
                      display: "inline-block", marginRight: 5,
                      fontWeight: insp.vehicleType === t ? "bold" : "normal",
                      border: insp.vehicleType === t ? "1.5px solid #000" : "none",
                      borderRadius: "50%", padding: "0 2px",
                    }}>{t}</span>
                  ))}
                </div>
              </td>
              <td style={{ border: BORDER, padding: "1px 3px", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>MECHANIC NAME (Signed)</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{insp.mechanicNameSigned || ""}</div>
              </td>
            </tr>
            <tr>
              <td colSpan={2} style={{ border: BORDER, padding: "1px 3px", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>VIN</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{insp.vin || ""}</div>
              </td>
              <td colSpan={2} style={{ border: BORDER, padding: "1px 3px", verticalAlign: "top" }}>
                <div style={{ fontSize: 6, fontWeight: "bold", background: SUB_HDR_BG, margin: "-1px -3px 1px", padding: "1px 3px", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>LICENSE PLATE NO.</div>
                <div style={{ fontSize: 8.5, minHeight: 12 }}>{insp.licensePlate || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── SECTION TITLE ── */}
        <div style={{
          background: "#000", color: "#fff", textAlign: "center",
          fontWeight: "bold", fontSize: 8, padding: "2px",
          textTransform: "uppercase", letterSpacing: "0.08em",
          marginBottom: 3,
          printColorAdjust: "exact", WebkitPrintColorAdjust: "exact",
        } as React.CSSProperties}>
          Vehicle Components Inspected
        </div>

        {/* ── 3-COLUMN GRID ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4 }}>
          <tbody>
            <tr style={{ verticalAlign: "top" }}>
              <td style={{ width: "33.33%", paddingRight: 3, verticalAlign: "top" }}>
                {col1.map(renderSection)}
              </td>
              <td style={{ width: "33.33%", paddingLeft: 2, paddingRight: 2, verticalAlign: "top" }}>
                {col2.map(renderSection)}
              </td>
              <td style={{ width: "33.33%", paddingLeft: 3, verticalAlign: "top" }}>
                {col3.map(renderSection)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── CERTIFICATION ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4 }}>
          <tbody>
            <tr>
              <td style={{ border: "2px solid #000", padding: "4px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    display: "inline-block", width: 14, height: 14, flexShrink: 0,
                    border: "2px solid #000", textAlign: "center", lineHeight: "13px",
                    fontSize: 11, fontWeight: "bold",
                  }}>
                    {insp.certifiedPassed ? "✔" : ""}
                  </span>
                  <span style={{ fontSize: 8 }}>
                    <strong>CERTIFICATION:</strong> THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS FOR THE QUARTERLY VEHICLE INSPECTION REPORT.
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── SUPPLEMENTAL ── */}
        {relatedRepairs.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th colSpan={5} style={{ background: CAT_BG, border: BORDER, padding: "2px 4px", textAlign: "left", fontSize: 7.5, fontWeight: "bold", textTransform: "uppercase", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>
                  Work Performed Since Last Inspection
                </th>
              </tr>
              <tr>
                {["RO #", "Date", "Complaint / Work Done", "Technician", "Status"].map(h => (
                  <th key={h} style={{ border: BORDER, padding: "1px 4px", background: SUB_HDR_BG, fontSize: 7, textAlign: "left", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relatedRepairs.map(ro => (
                <tr key={ro.id}>
                  <td style={{ border: BORDER, padding: "1px 4px", fontFamily: "monospace", fontSize: 7 }}>{ro.orderNumber}</td>
                  <td style={{ border: BORDER, padding: "1px 4px", fontSize: 7, whiteSpace: "nowrap" }}>
                    {ro.completedAt ? new Date(ro.completedAt).toLocaleDateString() : new Date(ro.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ border: BORDER, padding: "1px 4px", fontSize: 7 }}>
                    {ro.complaint || ""}{ro.diagnosis ? (ro.complaint ? " — " : "") + ro.diagnosis : ""}
                  </td>
                  <td style={{ border: BORDER, padding: "1px 4px", fontSize: 7 }}>{ro.technician || ""}</td>
                  <td style={{ border: BORDER, padding: "1px 4px", fontSize: 7, textTransform: "capitalize" }}>{ro.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── PRINT STYLES ── */}
      <style>{`
        @media print {
          /* Hide everything on the page */
          body * { visibility: hidden !important; }

          /* Show only the print content and all its descendants */
          #njmvc-print-content,
          #njmvc-print-content * { visibility: visible !important; }

          /* Position it at the top of the page */
          #njmvc-print-content {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            padding: 5mm 7mm !important;
            box-sizing: border-box !important;
            background: #fff !important;
          }

          /* Ensure background colors print */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

          @page { size: letter portrait; margin: 0; }
        }
      `}</style>
    </>
  );
}
