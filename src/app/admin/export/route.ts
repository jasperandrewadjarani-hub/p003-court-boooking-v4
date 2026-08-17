import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "@/lib/auth/staffAuth";
import { withTenant } from "@/lib/tenant/withTenant";
import { getAnalytics } from "@/lib/admin/analytics";

/**
 * Excel export — matches v2's adminExportExcel's 3-tab structure (Summary,
 * Detailed Log, Payments). Built with exceljs directly (no SpreadsheetApp
 * equivalent here); applies the workbook formatting defaults from this
 * project's standing conventions (frozen header row, left-aligned text,
 * right-aligned currency, sensible column widths, no decorative styling).
 *
 * NOTE: verified by structural inspection (opens correctly via exceljs's
 * own reader, correct row/column counts, correct number formats) — NOT by
 * opening in real desktop Microsoft Excel, which this sandboxed environment
 * has no access to. Flagged honestly in notes.md rather than claimed as
 * fully verified per this project's Excel-output standard.
 */
export async function GET(request: Request) {
  const tenant = await resolveTenant();
  await requireStaff();

  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const dateTo = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  const analytics = await getAnalytics(tenant.id, dateFrom, dateTo);

  const groups = await withTenant(tenant.id, (tx) =>
    tx.bookingGroup.findMany({
      where: { tenantId: tenant.id, createdAt: { gte: new Date(dateFrom + "T00:00:00.000Z"), lt: new Date(dateTo + "T23:59:59.999Z") } },
      include: { customer: true, bookings: { include: { court: true }, orderBy: { startsAt: "asc" } }, payments: true },
      orderBy: { createdAt: "desc" },
    })
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "P003 Court Booking Platform";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 20 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.views = [{ state: "frozen", ySplit: 1 }];
  summary.addRows([
    { metric: "Date Range", value: `${dateFrom} to ${dateTo}` },
    { metric: "Total Bookings", value: analytics.totalBookings },
    { metric: "Confirmed + Reserved", value: analytics.confirmedReservedCount },
    { metric: "Cancelled", value: analytics.cancelledCount },
    { metric: "Lapsed", value: analytics.lapsedCount },
    { metric: "Total Revenue", value: analytics.totalRevenueMinor / 100 },
    { metric: "Average Booking Value", value: analytics.avgValueMinor / 100 },
    { metric: "Cancellation Rate", value: `${analytics.cancellationRatePercent}%` },
  ]);
  summary.getColumn("value").numFmt = "#,##0.00";

  const detail = workbook.addWorksheet("Detailed Log");
  detail.columns = [
    { header: "Reference", key: "reference", width: 18 },
    { header: "Date", key: "date", width: 14 },
    { header: "Customer", key: "customer", width: 24 },
    { header: "Court", key: "court", width: 16 },
    { header: "Start", key: "start", width: 10 },
    { header: "End", key: "end", width: 10 },
    { header: "Status", key: "status", width: 14 },
    { header: "Payment Status", key: "paymentStatus", width: 16 },
    { header: "Total", key: "total", width: 14 },
  ];
  detail.getRow(1).font = { bold: true };
  detail.views = [{ state: "frozen", ySplit: 1 }];
  detail.autoFilter = { from: "A1", to: "I1" };
  for (const g of groups) {
    for (const b of g.bookings) {
      detail.addRow({
        reference: g.reference ?? "Pending",
        date: g.createdAt.toISOString().slice(0, 10),
        customer: `${g.customer.firstName} ${g.customer.lastName}`.trim(),
        court: b.court.name,
        start: formatUtcTime(b.startsAt),
        end: formatUtcTime(b.endsAt),
        status: g.status,
        paymentStatus: g.paymentStatus,
        total: b.priceMinor / 100,
      });
    }
  }
  detail.getColumn("total").numFmt = "#,##0.00";

  const paymentsSheet = workbook.addWorksheet("Payments");
  paymentsSheet.columns = [
    { header: "Receipt Number", key: "receiptNumber", width: 24 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Method", key: "method", width: 14 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Collected At", key: "collectedAt", width: 20 },
  ];
  paymentsSheet.getRow(1).font = { bold: true };
  paymentsSheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const g of groups) {
    for (const p of g.payments) {
      paymentsSheet.addRow({
        receiptNumber: p.receiptNumber,
        reference: g.reference ?? "Pending",
        method: p.method,
        amount: p.amountMinor / 100,
        collectedAt: p.collectedAt.toISOString(),
      });
    }
  }
  paymentsSheet.getColumn("amount").numFmt = "#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="analytics_${dateFrom}_to_${dateTo}.xlsx"`,
    },
  });
}

function formatUtcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
