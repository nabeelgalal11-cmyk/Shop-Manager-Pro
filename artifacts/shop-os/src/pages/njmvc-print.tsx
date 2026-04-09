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

const cellBorder = "1px solid #000";
const headerBg = "#c8c8c8";
const subHeaderBg = "#e8e8e8";

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
    cat.items?.forEach(item => {
      resultMap[item.id] = item.result;
    });
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
      <table key={section.catName} style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 16 }} />
          <col style={{ width: 16 }} />
          <col style={{ width: 38 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={4} style={{
              background: headerBg,
              border: cellBorder,
              fontSize: 7.5,
              fontWeight: "bold",
              textTransform: "uppercase",
              textAlign: "left",
              padding: "2px 3px",
              letterSpacing: "0.04em",
            }}>
              {section.catName}
            </th>
          </tr>
          <tr>
            <th style={{ background: subHeaderBg, border: cellBorder, fontSize: 6.5, textAlign: "center", padding: "1px 1px", fontWeight: "bold" }}>OK/NA</th>
            <th style={{ background: subHeaderBg, border: cellBorder, fontSize: 6.5, textAlign: "center", padding: "1px 1px", fontWeight: "bold" }}>NR</th>
            <th style={{ background: subHeaderBg, border: cellBorder, fontSize: 6.5, textAlign: "center", padding: "1px 1px", fontWeight: "bold" }}>DATE REP.</th>
            <th style={{ background: subHeaderBg, border: cellBorder, fontSize: 6.5, textAlign: "left", padding: "1px 3px", fontWeight: "bold" }}>ITEM</th>
          </tr>
        </thead>
        <tbody>
          {section.items.map((item, idx) => {
            const r = resultMap[item.id];
            const status = r?.status || null;
            const rowBg = idx % 2 === 0 ? "#fff" : "#f7f7f7";
            return (
              <tr key={item.id} style={{ background: rowBg }}>
                <td style={{ border: cellBorder, textAlign: "center", padding: "1px", verticalAlign: "middle" }}>
                  {status === "ok" && (
                    <span style={{ fontSize: 10, fontWeight: "bold", lineHeight: 1 }}>✔</span>
                  )}
                  {status === "na" && (
                    <span style={{ fontSize: 7, fontWeight: "bold", lineHeight: 1 }}>NA</span>
                  )}
                </td>
                <td style={{ border: cellBorder, textAlign: "center", padding: "1px", verticalAlign: "middle" }}>
                  {status === "needs_repair" && (
                    <span style={{ fontSize: 10, fontWeight: "bold", lineHeight: 1 }}>✔</span>
                  )}
                </td>
                <td style={{ border: cellBorder, textAlign: "center", fontSize: 6.5, padding: "1px 2px", verticalAlign: "middle" }}>
                  {status === "needs_repair" && r?.repairedDate ? r.repairedDate.slice(5) : ""}
                </td>
                <td style={{ border: cellBorder, fontSize: 7.5, padding: "1px 3px", verticalAlign: "middle" }}>
                  {item.label}
                  {item.hasMeasurement && (
                    <span style={{ fontSize: 6.5, color: "#555", marginLeft: 3 }}>
                      {r?.measurementValue ? `${r.measurementValue}${item.measurementUnit}` : `___${item.measurementUnit}`}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <>
      {/* Screen UI — hidden on print */}
      <div className="print:hidden flex items-center gap-3 p-4 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/njmvc/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-bold text-lg">Print NJMVC Inspection Report</h1>
          <p className="text-sm text-muted-foreground">
            {insp.vehicle?.year} {insp.vehicle?.make} {insp.vehicle?.model} ·{" "}
            {insp.inspectionDate ? new Date(insp.inspectionDate + "T00:00:00").toLocaleDateString() : new Date(insp.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" /> Print / Save PDF
        </Button>
      </div>

      {/* Print Content */}
      <div style={{ fontFamily: "Arial, Helvetica, sans-serif", padding: "8mm 10mm", maxWidth: "210mm", margin: "0 auto", background: "#fff", color: "#000" }}>

        {/* Title Bar */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4 }}>
          <tbody>
            <tr>
              <td style={{ background: headerBg, border: cellBorder, padding: "4px 8px", verticalAlign: "middle" }}>
                <div style={{ fontWeight: "bold", fontSize: 12, letterSpacing: "0.04em" }}>
                  STATE OF NEW JERSEY — MOTOR VEHICLE COMMISSION
                </div>
                <div style={{ fontWeight: "bold", fontSize: 10, letterSpacing: "0.03em" }}>
                  QUARTERLY VEHICLE INSPECTION REPORT
                </div>
              </td>
              <td style={{ background: headerBg, border: cellBorder, padding: "4px 8px", verticalAlign: "middle", width: "28%", textAlign: "right" }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>REPORT #</div>
                <div style={{ fontSize: 10, borderBottom: "1px solid #333", minWidth: 100, minHeight: 14 }}>{insp.reportNumber || ""}</div>
                <div style={{ fontSize: 8, fontWeight: "bold", marginTop: 4 }}>FLEET UNIT #</div>
                <div style={{ fontSize: 10, borderBottom: "1px solid #333", minWidth: 100, minHeight: 14 }}>{insp.fleetUnitNumber || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Operator / Date / Mechanic */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4 }}>
          <tbody>
            <tr>
              <td style={{ border: cellBorder, padding: "2px 4px", width: "40%", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>OPERATOR</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>{insp.operatorName || ""}</div>
              </td>
              <td style={{ border: cellBorder, padding: "2px 4px", width: "18%", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>MILES</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>{insp.mileage ? insp.mileage.toLocaleString() : ""}</div>
              </td>
              <td style={{ border: cellBorder, padding: "2px 4px", width: "18%", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>DATE</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>
                  {insp.inspectionDate ? new Date(insp.inspectionDate + "T00:00:00").toLocaleDateString() : ""}
                </div>
              </td>
              <td style={{ border: cellBorder, padding: "2px 4px", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>MECHANIC NAME (Print or Type)</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>{insp.mechanicNamePrint || ""}</div>
              </td>
            </tr>
            <tr>
              <td style={{ border: cellBorder, padding: "2px 4px", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>ADDRESS</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>{insp.address || ""}</div>
              </td>
              <td colSpan={2} style={{ border: cellBorder, padding: "2px 4px", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>VEHICLE TYPE (Circle One)</div>
                <div style={{ padding: "2px 0" }}>
                  {VEHICLE_TYPES.map(t => (
                    <span key={t} style={{
                      display: "inline-block",
                      marginRight: 6,
                      fontWeight: insp.vehicleType === t ? "bold" : "normal",
                      border: insp.vehicleType === t ? "1.5px solid #000" : "1px solid transparent",
                      borderRadius: "50%",
                      padding: "0 3px",
                      fontSize: 9,
                      background: insp.vehicleType === t ? "#ddd" : "transparent",
                    }}>{t}</span>
                  ))}
                </div>
              </td>
              <td style={{ border: cellBorder, padding: "2px 4px", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>MECHANIC NAME (Signed)</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>{insp.mechanicNameSigned || ""}</div>
              </td>
            </tr>
            <tr>
              <td colSpan={2} style={{ border: cellBorder, padding: "2px 4px", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>VIN</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>{insp.vin || ""}</div>
              </td>
              <td colSpan={2} style={{ border: cellBorder, padding: "2px 4px", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 7, fontWeight: "bold", background: subHeaderBg, margin: "-2px -4px 2px", padding: "1px 4px" }}>LICENSE PLATE NO.</div>
                <div style={{ fontSize: 9, minHeight: 14 }}>{insp.licensePlate || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Section Title */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4 }}>
          <tbody>
            <tr>
              <td style={{ background: "#000", color: "#fff", textAlign: "center", fontWeight: "bold", fontSize: 9, padding: "3px", letterSpacing: "0.08em", textTransform: "uppercase", border: cellBorder }}>
                Vehicle Components Inspected
              </td>
            </tr>
          </tbody>
        </table>

        {/* 3-Column Inspection Grid */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6 }}>
          <tbody>
            <tr style={{ verticalAlign: "top" }}>
              <td style={{ width: "33.33%", padding: "0 3px 0 0", verticalAlign: "top" }}>
                {col1.map(renderSection)}
              </td>
              <td style={{ width: "33.33%", padding: "0 2px", verticalAlign: "top" }}>
                {col2.map(renderSection)}
              </td>
              <td style={{ width: "33.33%", padding: "0 0 0 3px", verticalAlign: "top" }}>
                {col3.map(renderSection)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Certification */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6 }}>
          <tbody>
            <tr>
              <td style={{ border: "2px solid #000", padding: "5px 8px", background: "#f9f9f9" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    display: "inline-block", width: 16, height: 16, flexShrink: 0,
                    border: "2px solid #000", textAlign: "center", lineHeight: "15px",
                    fontSize: 12, fontWeight: "bold", background: insp.certifiedPassed ? "#fff" : "#fff",
                  }}>
                    {insp.certifiedPassed ? "✔" : ""}
                  </span>
                  <span style={{ fontSize: 8.5 }}>
                    <strong>CERTIFICATION:</strong> THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS FOR THE QUARTERLY VEHICLE INSPECTION REPORT.
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Supplemental: Work Performed Since Last Inspection */}
        {relatedRepairs.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th colSpan={5} style={{ background: headerBg, border: cellBorder, padding: "3px 6px", textAlign: "left", fontSize: 9, fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Work Performed Since Last Inspection
                  </th>
                </tr>
                <tr>
                  <th style={{ border: cellBorder, padding: "2px 4px", background: subHeaderBg, fontSize: 7.5, textAlign: "left", width: "12%" }}>RO #</th>
                  <th style={{ border: cellBorder, padding: "2px 4px", background: subHeaderBg, fontSize: 7.5, textAlign: "left", width: "12%" }}>Date</th>
                  <th style={{ border: cellBorder, padding: "2px 4px", background: subHeaderBg, fontSize: 7.5, textAlign: "left" }}>Complaint / Work Done</th>
                  <th style={{ border: cellBorder, padding: "2px 4px", background: subHeaderBg, fontSize: 7.5, textAlign: "left", width: "15%" }}>Technician</th>
                  <th style={{ border: cellBorder, padding: "2px 4px", background: subHeaderBg, fontSize: 7.5, textAlign: "left", width: "10%" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {relatedRepairs.map((ro, idx) => (
                  <tr key={ro.id} style={{ background: idx % 2 === 0 ? "#fff" : "#f7f7f7" }}>
                    <td style={{ border: cellBorder, padding: "2px 4px", fontFamily: "monospace", fontSize: 7.5 }}>{ro.orderNumber}</td>
                    <td style={{ border: cellBorder, padding: "2px 4px", fontSize: 7.5, whiteSpace: "nowrap" }}>
                      {ro.completedAt
                        ? new Date(ro.completedAt).toLocaleDateString()
                        : new Date(ro.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ border: cellBorder, padding: "2px 4px", fontSize: 7.5 }}>
                      {ro.complaint || ""}{ro.diagnosis ? (ro.complaint ? " — " : "") + ro.diagnosis : ""}
                    </td>
                    <td style={{ border: cellBorder, padding: "2px 4px", fontSize: 7.5 }}>{ro.technician || ""}</td>
                    <td style={{ border: cellBorder, padding: "2px 4px", fontSize: 7.5, textTransform: "capitalize" }}>{ro.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          header, nav, aside, [class*="sidebar"], [class*="Sidebar"],
          [data-sidebar], [data-sidebar-provider] > div > aside {
            display: none !important;
          }
          body { margin: 0; }
          @page { size: letter portrait; margin: 8mm; }
        }
      `}</style>
    </>
  );
}
