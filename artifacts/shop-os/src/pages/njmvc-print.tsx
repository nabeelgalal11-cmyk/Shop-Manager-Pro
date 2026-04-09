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

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span style={{ display: "inline-block", width: 14, height: 14, border: "1.5px solid #333", textAlign: "center", lineHeight: "13px", fontSize: 11 }}>
      {checked ? "✓" : ""}
    </span>
  );
}

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
  purchaseDate: string | null;
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

  // Build flat result map from template
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

  // Fixed column assignment based on official NJMVC form layout.
  // The 20 official categories are distributed as columns 1 (sort 0-6), 2 (sort 7-13), 3 (sort 14+).
  const col1 = allSections.filter((_, i) => i < 7);
  const col2 = allSections.filter((_, i) => i >= 7 && i < 14);
  const col3 = allSections.filter((_, i) => i >= 14);

  function renderSection(section: PrintSection) {
    return (
      <div key={section.catName} style={{ marginBottom: 8 }}>
        <div style={{
          fontWeight: "bold", fontSize: 8, textTransform: "uppercase",
          borderBottom: "1px solid #333", paddingBottom: 1, marginBottom: 3,
          letterSpacing: "0.05em",
        }}>
          {section.catName}
        </div>
        {section.items.map(item => {
          const r = resultMap[item.id];
          return (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 2, fontSize: 7.5 }}>
              <CheckBox checked={r?.status === "ok"} />
              <CheckBox checked={r?.status === "needs_repair"} />
              <CheckBox checked={r?.status === "na"} />
              <span style={{ width: 36, fontSize: 7, color: "#555" }}>
                {r?.repairedDate ? r.repairedDate.slice(5) : ""}
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.hasMeasurement && (
                <span style={{ fontSize: 7, color: "#444" }}>
                  {r?.measurementValue ? `${r.measurementValue}${item.measurementUnit}` : `___${item.measurementUnit}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
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
      <div style={{ fontFamily: "Arial, Helvetica, sans-serif", padding: "10mm", maxWidth: "210mm", margin: "0 auto", background: "#fff", color: "#000" }}>

        {/* Title Row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, borderBottom: "2px solid #000", paddingBottom: 4 }}>
          <div style={{ fontWeight: "bold", fontSize: 13, letterSpacing: "0.05em" }}>
            NJMVC QUARTERLY VEHICLE INSPECTION REPORT
          </div>
          <div style={{ textAlign: "right", fontSize: 8 }}>
            <div><strong>REPORT #</strong> {insp.reportNumber || "___________"}</div>
            <div style={{ marginTop: 2 }}><strong>FLEET UNIT NUMBER</strong> {insp.fleetUnitNumber || "___________"}</div>
          </div>
        </div>

        {/* Operator / Mechanic Row */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 5 }}>
          <tbody>
            <tr>
              <td style={{ width: "45%", verticalAlign: "bottom", paddingRight: 10 }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>OPERATOR</div>
                <div style={{ borderBottom: "1px solid #333", minHeight: 16, fontSize: 9 }}>{insp.operatorName || ""}</div>
              </td>
              <td style={{ width: "20%", verticalAlign: "bottom", paddingRight: 10 }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>MILES</div>
                <div style={{ borderBottom: "1px solid #333", minHeight: 16, fontSize: 9 }}>{insp.mileage ? insp.mileage.toLocaleString() : ""}</div>
              </td>
              <td style={{ width: "15%", verticalAlign: "bottom", paddingRight: 10 }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>DATE</div>
                <div style={{ borderBottom: "1px solid #333", minHeight: 16, fontSize: 9 }}>
                  {insp.inspectionDate ? new Date(insp.inspectionDate + "T00:00:00").toLocaleDateString() : ""}
                </div>
              </td>
              <td style={{ width: "20%", verticalAlign: "bottom" }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>MECHANIC NAME (Print or Type)</div>
                <div style={{ borderBottom: "1px solid #333", minHeight: 16, fontSize: 9 }}>{insp.mechanicNamePrint || ""}</div>
              </td>
            </tr>
            <tr style={{ marginTop: 4 }}>
              <td style={{ paddingTop: 4, paddingRight: 10, verticalAlign: "bottom" }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>ADDRESS</div>
                <div style={{ borderBottom: "1px solid #333", minHeight: 16, fontSize: 9 }}>{insp.address || ""}</div>
              </td>
              <td colSpan={2} style={{ paddingTop: 4 }} />
              <td style={{ paddingTop: 4, verticalAlign: "bottom" }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>MECHANIC NAME SIGNED</div>
                <div style={{ borderBottom: "1px solid #333", minHeight: 16, fontSize: 9 }}>{insp.mechanicNameSigned || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Vehicle Type + Identification */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6 }}>
          <tbody>
            <tr>
              <td style={{ width: "50%", paddingRight: 10, verticalAlign: "middle" }}>
                <span style={{ fontSize: 8, fontWeight: "bold" }}>VEHICLE TYPE (Circle One)&nbsp;&nbsp;</span>
                {VEHICLE_TYPES.map(t => (
                  <span key={t} style={{
                    display: "inline-block",
                    marginRight: 8,
                    fontWeight: insp.vehicleType === t ? "bold" : "normal",
                    border: insp.vehicleType === t ? "1.5px solid #000" : "none",
                    borderRadius: "50%",
                    padding: "0 3px",
                    fontSize: 9,
                  }}>{t}</span>
                ))}
              </td>
              <td style={{ verticalAlign: "bottom" }}>
                <div style={{ fontSize: 8, fontWeight: "bold" }}>VEHICLE IDENTIFICATION</div>
                <div style={{ fontSize: 8 }}>VIN: <span style={{ borderBottom: "1px solid #333", display: "inline-block", minWidth: 120, fontSize: 9 }}>{insp.vin || ""}</span></div>
                <div style={{ fontSize: 8 }}>LIC. PLATE NO.: <span style={{ borderBottom: "1px solid #333", display: "inline-block", minWidth: 80, fontSize: 9 }}>{insp.licensePlate || ""}</span></div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Component Inspection Grid Header */}
        <div style={{ fontWeight: "bold", fontSize: 9, textAlign: "center", borderTop: "1.5px solid #000", borderBottom: "1px solid #000", padding: "2px 0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Vehicle Components Inspected
        </div>

        {/* Column sub-headers */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 8px", marginBottom: 3 }}>
          {[0, 1, 2].map(col => (
            <div key={col} style={{ display: "flex", gap: 3, fontSize: 7, color: "#555", marginBottom: 2 }}>
              <span style={{ width: 14, textAlign: "center" }}>OK</span>
              <span style={{ width: 14, textAlign: "center" }}>NR</span>
              <span style={{ width: 14, textAlign: "center" }}>NA</span>
              <span style={{ width: 36 }}>Repaired</span>
              <span>Item</span>
            </div>
          ))}
        </div>

        {/* 3-Column Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 10px", marginBottom: 8 }}>
          <div>{col1.map(renderSection)}</div>
          <div>{col2.map(renderSection)}</div>
          <div>{col3.map(renderSection)}</div>
        </div>

        {/* Certification */}
        <div style={{ border: "1.5px solid #000", padding: "6px 10px", fontSize: 8.5, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-block", width: 14, height: 14,
              border: "1.5px solid #333", textAlign: "center", lineHeight: "13px", fontSize: 11,
              flexShrink: 0,
            }}>
              {insp.certifiedPassed ? "✓" : ""}
            </span>
            <span>
              <strong>CERTIFICATION:</strong> THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS FOR THE QUARTERLY VEHICLE INSPECTION REPORT.
            </span>
          </div>
        </div>

        {/* Supplemental: Work Performed Since Last Inspection */}
        {relatedRepairs.length > 0 && (
          <div style={{ marginTop: 10, borderTop: "1.5px dashed #666", paddingTop: 8 }}>
            <div style={{ fontWeight: "bold", fontSize: 10, marginBottom: 4 }}>
              SUPPLEMENTAL — Work Performed Since Last Inspection
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 8 }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  <th style={{ border: "1px solid #ccc", padding: "2px 4px", textAlign: "left" }}>RO #</th>
                  <th style={{ border: "1px solid #ccc", padding: "2px 4px", textAlign: "left" }}>Date</th>
                  <th style={{ border: "1px solid #ccc", padding: "2px 4px", textAlign: "left" }}>Complaint / Work Done</th>
                  <th style={{ border: "1px solid #ccc", padding: "2px 4px", textAlign: "left" }}>Technician</th>
                  <th style={{ border: "1px solid #ccc", padding: "2px 4px", textAlign: "left" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {relatedRepairs.map(ro => (
                  <tr key={ro.id}>
                    <td style={{ border: "1px solid #ccc", padding: "2px 4px", fontFamily: "monospace" }}>{ro.orderNumber}</td>
                    <td style={{ border: "1px solid #ccc", padding: "2px 4px", whiteSpace: "nowrap" }}>
                      {ro.completedAt
                        ? new Date(ro.completedAt).toLocaleDateString()
                        : new Date(ro.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>
                      {ro.complaint || ""}{ro.diagnosis ? (ro.complaint ? " — " : "") + ro.diagnosis : ""}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: "2px 4px" }}>{ro.technician || ""}</td>
                    <td style={{ border: "1px solid #ccc", padding: "2px 4px", textTransform: "capitalize" }}>{ro.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Print styles — hide all app chrome (sidebar, nav, header) when printing */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          /* Hide the shared layout chrome */
          header, nav, aside, [class*="sidebar"], [class*="Sidebar"],
          [data-sidebar], [data-sidebar-provider] > div > aside {
            display: none !important;
          }
          body { margin: 0; }
          @page { size: letter; margin: 10mm; }
        }
      `}</style>
    </>
  );
}
