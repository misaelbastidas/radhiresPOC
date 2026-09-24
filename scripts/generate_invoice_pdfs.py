"""Generate synthetic automotive-parts invoice PDFs for the OCR harness.

Digital PDFs contain a text layer. The low-confidence sample is intentionally
image-only so the browser pipeline has to use its OCR fallback.
"""

from pathlib import Path
import tempfile

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "fixtures" / "autoparts"
OUTPUT_DIR = ROOT / "samples" / "autoparts" / "pdf"


def parse_source(path: Path):
    values = {}
    line_item = ""
    notes = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("Line item:"):
            line_item = line.split(":", 1)[1].strip()
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            if key in {"Email note", "Warning", "Source note", "Document type"}:
                notes.append(value.strip())
            else:
                values[key.strip()] = value.strip()
    return values, line_item, notes


def amount(value):
    if not value:
        return ""
    return value.replace("USD", "").strip()


def title_for(values):
    return "CREDIT MEMO" if "Credit memo number" in values else "INVOICE"


def draw_digital_pdf(source: Path, destination: Path):
    values, line_item, notes = parse_source(source)
    page_width, page_height = letter
    pdf = canvas.Canvas(str(destination), pagesize=letter)
    teal = colors.HexColor("#0B746C")
    navy = colors.HexColor("#162A3A")
    muted = colors.HexColor("#657583")
    light = colors.HexColor("#E9EFF2")

    pdf.setFillColor(navy)
    pdf.rect(0, page_height - 1.05 * inch, page_width, 1.05 * inch, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(0.6 * inch, page_height - 0.58 * inch, values.get("Vendor", "Synthetic Parts Supplier"))
    pdf.setFont("Helvetica", 9)
    pdf.drawString(0.6 * inch, page_height - 0.78 * inch, "Automotive parts and fleet supply division")

    pdf.setFillColor(teal)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawRightString(page_width - 0.6 * inch, page_height - 0.55 * inch, title_for(values))
    pdf.setFillColor(colors.HexColor("#C3D5D8"))
    pdf.setFont("Helvetica", 8)
    pdf.drawRightString(page_width - 0.6 * inch, page_height - 0.76 * inch, "SYNTHETIC SAMPLE / AP HARNESS")

    y = page_height - 1.48 * inch
    pdf.setFillColor(muted)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(0.6 * inch, y, "SUPPLIER DETAILS")
    pdf.drawString(3.7 * inch, y, "DOCUMENT DETAILS")
    y -= 0.18 * inch
    pdf.setFillColor(navy)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(0.6 * inch, y, f"Tax ID: {values.get('Tax ID', '')}")
    pdf.drawString(3.7 * inch, y, f"Invoice number: {values.get('Invoice number', values.get('Credit memo number', ''))}")
    y -= 0.18 * inch
    pdf.drawString(0.6 * inch, y, f"Payment terms: {values.get('Payment terms', '')}")
    pdf.drawString(3.7 * inch, y, f"Invoice date: {values.get('Invoice date', values.get('Credit memo date', ''))}")
    y -= 0.18 * inch
    pdf.drawString(0.6 * inch, y, f"Purchase order: {values.get('Purchase order', 'Not provided')}")
    pdf.drawString(3.7 * inch, y, f"Service period: {values.get('Service period', '')}")

    y -= 0.43 * inch
    pdf.setFillColor(light)
    pdf.rect(0.6 * inch, y - 0.28 * inch, page_width - 1.2 * inch, 0.28 * inch, fill=1, stroke=0)
    pdf.setFillColor(muted)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(0.75 * inch, y - 0.18 * inch, "DESCRIPTION")
    pdf.drawRightString(5.55 * inch, y - 0.18 * inch, "QTY")
    pdf.drawRightString(6.55 * inch, y - 0.18 * inch, "AMOUNT")
    y -= 0.5 * inch
    pdf.setFillColor(navy)
    pdf.setFont("Helvetica", 9)
    if line_item:
        pieces = [part.strip() for part in line_item.split("|")]
        description = pieces[0]
        quantity = next((part.split(":", 1)[1].strip() for part in pieces if part.startswith("Quantity:")), "1")
        line_amount = next((part.split(":", 1)[1].strip() for part in pieces if part.startswith("Line amount:")), "")
        pdf.drawString(0.75 * inch, y, description[:70])
        pdf.drawRightString(5.55 * inch, y, quantity)
        pdf.drawRightString(6.55 * inch, y, amount(line_amount))
    y -= 0.24 * inch
    pdf.setStrokeColor(light)
    pdf.line(0.75 * inch, y, page_width - 0.75 * inch, y)

    y -= 0.34 * inch
    pdf.setFillColor(muted)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(4.5 * inch, y, "Subtotal")
    pdf.drawRightString(6.55 * inch, y, amount(values.get("Subtotal", "")))
    y -= 0.2 * inch
    pdf.drawString(4.5 * inch, y, "Tax")
    pdf.drawRightString(6.55 * inch, y, amount(values.get("Tax", "")))
    y -= 0.24 * inch
    pdf.setFillColor(teal)
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(4.5 * inch, y, "Total due")
    pdf.drawRightString(6.55 * inch, y, amount(values.get("Total due", "")))

    y -= 0.42 * inch
    if "Invoice reference" in values:
        notes.insert(0, f"Reference invoice: {values['Invoice reference']}")
    if notes:
        pdf.setFillColor(colors.HexColor("#FFF7E7"))
        pdf.roundRect(0.6 * inch, y - 0.62 * inch, page_width - 1.2 * inch, 0.62 * inch, 5, fill=1, stroke=0)
        pdf.setFillColor(colors.HexColor("#775A2A"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(0.78 * inch, y - 0.2 * inch, "NOTE")
        pdf.setFont("Helvetica", 8)
        note = " ".join(notes)
        pdf.drawString(1.2 * inch, y - 0.2 * inch, note[:115])

    pdf.setFillColor(muted)
    pdf.setFont("Helvetica", 7)
    pdf.drawString(0.6 * inch, 0.42 * inch, "Synthetic sample for Ledgerline AP exception harness - not a real tax document")
    pdf.drawRightString(page_width - 0.6 * inch, 0.42 * inch, "Page 1 of 1")
    pdf.save()


def find_font(size):
    candidates = [Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/calibri.ttf")]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_scan_pdf(source: Path, destination: Path):
    values, line_item, notes = parse_source(source)
    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = Path(temp_dir) / "scan.png"
        image = Image.new("RGB", (1275, 1650), "#F3F1EC")
        draw = ImageDraw.Draw(image)
        title_font = find_font(48)
        section_font = find_font(25)
        body_font = find_font(22)
        small_font = find_font(18)
        x = 90
        y = 85
        draw.text((x, y), values.get("Vendor", "Scanline Auto Supply"), fill="#263238", font=title_font)
        draw.text((930, y + 10), "INVOICE", fill="#607D8B", font=section_font)
        y += 105
        draw.line((x, y, 1185, y), fill="#B0BEC5", width=3)
        y += 45
        for label in ["Tax ID", "Invoice number", "Invoice date", "Purchase order", "Service period", "Payment terms"]:
            draw.text((x, y), f"{label}: {values.get(label, 'Not provided')}", fill="#37474F", font=body_font)
            y += 40
        y += 20
        draw.rectangle((x, y, 1185, y + 45), fill="#CFD8DC")
        draw.text((x + 18, y + 10), "DESCRIPTION", fill="#37474F", font=small_font)
        draw.text((930, y + 10), "AMOUNT", fill="#37474F", font=small_font)
        y += 75
        description = line_item.split("|")[0] if line_item else "Low-confidence scanned line item"
        draw.text((x, y), description, fill="#263238", font=body_font)
        y += 60
        draw.line((x, y, 1185, y), fill="#B0BEC5", width=2)
        draw.text((x, y + 70), "Please see page 2 for tax and total.", fill="#607D8B", font=body_font)
        draw.text((x, y + 135), "SCAN QUALITY: LOW - VERIFY BEFORE POSTING", fill="#9C4A2E", font=section_font)

        totals_page = Image.new("RGB", (1275, 1650), "#F3F1EC")
        totals_draw = ImageDraw.Draw(totals_page)
        totals_draw.text((x, 95), values.get("Vendor", "Scanline Auto Supply"), fill="#263238", font=title_font)
        totals_draw.text((930, 105), "PAGE 2", fill="#607D8B", font=section_font)
        totals_draw.line((x, 170, 1185, 170), fill="#B0BEC5", width=3)
        totals_draw.text((x, 235), "TAX AND TOTAL SUMMARY", fill="#37474F", font=section_font)
        y = 350
        for label in ["Subtotal", "Tax", "Total due"]:
            totals_draw.text((760, y), label, fill="#607D8B", font=body_font)
            totals_draw.text((1030, y), values.get(label, ""), fill="#263238", font=body_font)
            y += 58
        totals_draw.text((x, 650), "SCAN QUALITY: LOW - VERIFY TAX AND TOTAL BEFORE POSTING", fill="#9C4A2E", font=section_font)
        totals_draw.text((x, 760), "This page is intentionally image-only for OCR testing.", fill="#607D8B", font=body_font)
        image.save(image_path, "PDF", resolution=150.0, save_all=True, append_images=[totals_page])
        image_path.replace(destination)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source_files = sorted(SOURCE_DIR.glob("*.txt"))
    for source in source_files:
        destination = OUTPUT_DIR / f"{source.stem}.pdf"
        draw_digital_pdf(source, destination)
    scan_source = SOURCE_DIR / "scanline-9008-low-confidence.txt"
    draw_scan_pdf(scan_source, OUTPUT_DIR / "scanline-9008-low-confidence-rebuilt.pdf")
    print(f"Generated {len(source_files) + 1} PDFs in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
