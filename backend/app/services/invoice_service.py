"""Generate PDF invoices from payment transactions."""

import io
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


def _escape(s: str) -> str:
    """Escape for ReportLab Paragraph (basic HTML entities)."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") if s else ""


def _format_address(addr: Optional[dict]) -> str:
    if not addr:
        return ""
    parts = []
    if addr.get("line1"):
        parts.append(_escape(str(addr["line1"])))
    if addr.get("line2"):
        parts.append(_escape(str(addr["line2"])))
    city_parts = []
    if addr.get("city"):
        city_parts.append(_escape(str(addr["city"])))
    if addr.get("state"):
        city_parts.append(_escape(str(addr["state"])))
    if addr.get("postal_code"):
        city_parts.append(_escape(str(addr["postal_code"])))
    if city_parts:
        parts.append(", ".join(city_parts))
    if addr.get("country"):
        parts.append(_escape(str(addr["country"])))
    return "\n".join(parts)


def generate_invoice_pdf(
    invoice_number: str,
    invoice_date: datetime,
    company_name: str,
    billing_address: Optional[dict],
    billing_email: Optional[str],
    plan_name: str,
    amount: Decimal,
    currency: str,
    status: str = "Paid",
    platform_name: str = "SSHCONTROL",
    duration_label: Optional[str] = None,
    max_users: Optional[int] = None,
    max_servers: Optional[int] = None,
) -> bytes:
    """Generate a PDF invoice and return as bytes."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )
    styles = getSampleStyleSheet()
    platform_style = ParagraphStyle(
        "Platform",
        parent=styles["Heading1"],
        fontSize=22,
        textColor=colors.HexColor("#0d9488"),
        spaceAfter=2,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading2"],
        fontSize=11,
        spaceAfter=4,
        textColor=colors.HexColor("#374151"),
    )
    normal_style = styles["Normal"]

    story = []

    # Header: SSHCONTROL top left, INVOICE right
    header_row = [
        Paragraph(f"<b>{_escape(platform_name)}</b>", platform_style),
        Paragraph(
            "INVOICE",
            ParagraphStyle("Invoice", parent=styles["Heading2"], fontSize=18, alignment=2, spaceAfter=0),
        ),
    ]
    header_table = Table([header_row], colWidths=[100 * mm, 75 * mm])
    header_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 20))

    # Two columns: Bill To (left) and Invoice details (right)
    bill_to = f"<b>Bill To</b><br/>{_escape(company_name)}"
    if billing_address:
        bill_to += f"<br/>{_format_address(billing_address).replace(chr(10), '<br/>')}"
    if billing_email:
        bill_to += f"<br/>{_escape(billing_email)}"

    invoice_info = f"<b>Invoice #</b> {invoice_number}<br/>"
    invoice_info += f"<b>Date</b> {invoice_date.strftime('%B %d, %Y')}<br/>"
    invoice_info += f"<b>Status</b> {status}"

    header_data = [
        [Paragraph(bill_to, normal_style), Paragraph(invoice_info, normal_style)],
    ]
    header_table2 = Table(header_data, colWidths=[100 * mm, 75 * mm])
    header_table2.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(header_table2)
    story.append(Spacer(1, 25))

    # Line items table - purchased plan details
    story.append(Paragraph("Purchased Plan Details", heading_style))
    plan_desc = _escape(plan_name)
    if duration_label:
        plan_desc += f" — {_escape(duration_label)}"
    if max_users is not None and max_servers is not None:
        plan_desc += f" — {max_users} users, {max_servers} servers"
    items_data = [
        ["Description", "Amount"],
        [plan_desc, f"{currency} {amount:,.2f}"],
    ]
    items_table = Table(items_data, colWidths=[120 * mm, 55 * mm])
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#374151")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#1f2937")),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("TOPPADDING", (0, 1), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, colors.HexColor("#d1d5db")),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 15))

    # Total
    total_data = [["Total", f"{currency} {amount:,.2f}"]]
    total_table = Table(total_data, colWidths=[120 * mm, 55 * mm])
    total_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (1, 0), 11),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(total_table)
    story.append(Spacer(1, 40))

    # Footer
    story.append(Paragraph(
        "Thank you for your business.",
        ParagraphStyle("Thanks", parent=normal_style, fontSize=9, textColor=colors.HexColor("#6b7280")),
    ))
    story.append(Paragraph(
        f"This invoice was generated on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}.",
        ParagraphStyle("Footer", parent=normal_style, fontSize=8, textColor=colors.HexColor("#9ca3af")),
    ))

    doc.build(story)
    return buffer.getvalue()
