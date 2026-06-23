"""Branded invoice rendering (PDF + HTML preview).

Produces a professional AU tax invoice from an ``InvoiceDraft`` and a brand
dict. Both the PDF (Pillow raster, A4 @ 150 DPI) and the on-screen HTML preview
are driven from the same brand + draft data so they stay aligned.

Pillow is used for the PDF because it is already a project dependency; this
avoids adding a new locked dependency. The output is a single-page raster PDF.

Guardrail: rendering is purely local. It creates/refreshes the in-app PDF
artifact only — it never emails a tenant, posts to Xero, or dispatches a
provider. Branding is resolved defensively: if a per-entity brand record is
missing or unreadable, sensible defaults are used so an invoice can always be
rendered.
"""

# The HTML preview is an inline template; its CSS/markup lines intentionally
# run past the 100-col limit for readability of the template itself.
# ruff: noqa: E501
from __future__ import annotations

from html import escape
from io import BytesIO
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    from stewart.core.models import InvoiceDraft

# Default Leasium accent; per-entity branding overrides this once configured.
DEFAULT_ACCENT = "#15565a"
DEFAULT_INK = "#1b2430"
DEFAULT_MUTED = "#5d6b7a"
DEFAULT_LINE = "#e2e7ee"
DEFAULT_FOOTER = (
    "This document is a tax invoice for GST purposes — please retain it for "
    "your records."
)


def _money(cents: int | None, currency: str = "AUD") -> str:
    if cents is None:
        return "-"
    symbol = "$" if currency in {"AUD", "USD", "NZD", "SGD"} else ""
    return f"{symbol}{cents / 100:,.2f}"


def _monogram(name: str | None) -> str:
    parts = [p for p in (name or "").split() if p[:1].isalnum()]
    if not parts:
        return "IN"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][:1] + parts[1][:1]).upper()


def _active_lines(draft: InvoiceDraft) -> list[Any]:
    return [line for line in draft.lines if line.deleted_at is None]


def resolve_invoice_brand(draft: InvoiceDraft, session: Any | None = None) -> dict[str, Any]:
    """Resolve the brand dict for an invoice.

    Reads a per-entity ``EntityBranding`` record when one exists, falling back
    to safe defaults derived from the draft. Any lookup error degrades to
    defaults so rendering never fails.
    """
    brand: dict[str, Any] = {
        "issuer_name": draft.issuer_name or "Issuer to confirm",
        "issuer_abn": draft.issuer_abn,
        "accent": DEFAULT_ACCENT,
        "address": None,
        "contact_email": None,
        "contact_phone": None,
        "payment": [],
        "footer": DEFAULT_FOOTER,
    }
    if session is None:
        return brand
    try:
        from stewart.core.models import EntityBranding  # local import: optional

        record = (
            session.query(EntityBranding)
            .filter(
                EntityBranding.entity_id == draft.entity_id,
                EntityBranding.deleted_at.is_(None),
            )
            .one_or_none()
        )
    except Exception:
        # Table/model not present yet, or any read failure — use defaults.
        return brand
    if record is None:
        return brand
    if record.accent_color:
        brand["accent"] = record.accent_color
    brand["address"] = record.business_address or None
    brand["contact_email"] = record.contact_email or None
    brand["contact_phone"] = record.contact_phone or None
    if record.footer_terms:
        brand["footer"] = record.footer_terms
    payment: list[tuple[str, str]] = []
    if record.payment_payid:
        payment.append(("Pay by PayID", record.payment_payid))
    if record.payment_bpay_biller:
        ref = record.payment_bpay_reference or (draft.invoice_number or "")
        payment.append(
            ("Pay by BPAY", f"Biller {record.payment_bpay_biller} · Ref {ref}".strip(" ·"))
        )
    if record.payment_bank_bsb or record.payment_bank_account:
        bank = " · ".join(
            part
            for part in [
                f"BSB {record.payment_bank_bsb}" if record.payment_bank_bsb else "",
                f"Acct {record.payment_bank_account}" if record.payment_bank_account else "",
            ]
            if part
        )
        ref = draft.invoice_number or ""
        payment.append(("Pay by EFT", bank + (f" · Ref {ref}" if ref else "")))
    brand["payment"] = payment
    return brand


# ---------------------------------------------------------------------------
# PDF (Pillow raster, A4 @ 150 DPI)
# ---------------------------------------------------------------------------


# The bundled Pillow font lacks some typographic glyphs (em/en dash, ellipsis,
# smart quotes); map them to ASCII so the raster PDF never shows tofu boxes.
_FONT_SAFE = str.maketrans(
    {"—": "-", "–": "-", "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'", " ": " "}
)


def _safe(value: Any) -> str:
    return ("" if value is None else str(value)).translate(_FONT_SAFE)


def _hex_rgb(value: str) -> tuple[int, int, int]:
    v = (value or "").lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    try:
        return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
    except (ValueError, IndexError):
        return (21, 86, 90)


def _tint(rgb: tuple[int, int, int], keep: float = 0.12) -> tuple[int, int, int]:
    """Mix ``rgb`` toward white, keeping ``keep`` of the original."""
    return tuple(int(c * keep + 255 * (1 - keep)) for c in rgb)  # type: ignore[return-value]


def _render_invoice_image(draft: InvoiceDraft, brand: dict[str, Any]):
    from PIL import Image, ImageDraw, ImageFont

    width, height, margin = 1240, 1754, 96
    accent = _hex_rgb(brand.get("accent") or DEFAULT_ACCENT)
    ink = _hex_rgb(DEFAULT_INK)
    muted = _hex_rgb(DEFAULT_MUTED)
    line_c = _hex_rgb(DEFAULT_LINE)
    currency = draft.currency or "AUD"

    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    def font(size: int):
        try:
            return ImageFont.load_default(size=size)
        except TypeError:  # pragma: no cover - very old Pillow
            return ImageFont.load_default()

    def text(xy, value, size, fill, *, bold=False, anchor="la", max_w=None):
        glyph = font(size)
        s = _safe(value)
        if max_w is not None and s:
            ell = ""
            while s and draw.textlength(s + ell, font=glyph) > max_w:
                s = s[:-1]
                ell = "..."
            s = s + ell
        kwargs: dict[str, Any] = {"font": glyph, "fill": fill, "anchor": anchor}
        if bold:
            kwargs["stroke_width"] = 1
            kwargs["stroke_fill"] = fill
        draw.text(xy, s, **kwargs)

    right = width - margin
    draw.rectangle([0, 0, width, 14], fill=accent)
    y = margin

    # Header — monogram + issuer (left), TAX INVOICE + number + due chip (right)
    draw.rounded_rectangle([margin, y, margin + 92, y + 92], radius=20, fill=accent)
    text((margin + 46, y + 47), _monogram(brand["issuer_name"]), 40, "white", bold=True, anchor="mm")
    ix = margin + 116
    text((ix, y + 2), brand["issuer_name"], 28, ink, bold=True, max_w=600)
    iy = y + 44
    for meta in [
        f"ABN {brand['issuer_abn']}" if brand.get("issuer_abn") else None,
        brand.get("address"),
        " · ".join(x for x in [brand.get("contact_email"), brand.get("contact_phone")] if x)
        or None,
    ]:
        if meta:
            text((ix, iy), meta, 21, muted, max_w=600)
            iy += 30

    text((right, y), "TAX INVOICE", 20, accent, bold=True, anchor="ra")
    text((right, y + 28), draft.invoice_number or "Draft", 40, ink, bold=True, anchor="ra")
    due = f"Amount due {_money(draft.total_cents, currency)}"
    due_w = draw.textlength(due, font=font(22))
    draw.rounded_rectangle([right - due_w - 40, y + 90, right, y + 138], radius=24, fill=_tint(accent))
    text((right - 20, y + 114), due, 22, accent, bold=True, anchor="rm")

    y += 162
    draw.rectangle([margin, y, right, y + 3], fill=accent)
    y += 40

    # Bill-to + dates
    text((margin, y), "BILL TO", 18, muted, bold=True)
    text((margin, y + 30), draft.recipient_name or "Recipient to confirm", 26, ink, bold=True, max_w=560)
    text((margin, y + 68), draft.recipient_email or "Billing email to confirm", 21, muted, max_w=560)
    cx = right - 360
    text((cx, y), "ISSUE DATE", 18, muted, bold=True)
    text((cx, y + 30), draft.issue_date.isoformat() if draft.issue_date else "-", 24, ink, bold=True)
    text((cx + 200, y), "DUE DATE", 18, muted, bold=True)
    text((cx + 200, y + 30), draft.due_date.isoformat() if draft.due_date else "-", 24, ink, bold=True)
    y += 118

    # Line items
    col_gst = right - 320
    col_amt = right
    text((margin, y), "DESCRIPTION", 18, muted, bold=True)
    text((col_gst, y), "GST", 18, muted, bold=True, anchor="ma")
    text((col_amt, y), "AMOUNT (EX GST)", 18, muted, bold=True, anchor="ra")
    y += 32
    draw.rectangle([margin, y, right, y + 2], fill=ink)
    y += 24
    for line in _active_lines(draft):
        text((margin, y), line.description, 24, ink, bold=True, max_w=col_gst - margin - 50)
        text((col_gst, y + 2), "10%" if (line.gst_cents or 0) > 0 else "GST-free", 21, ink, anchor="ma")
        text((col_amt, y + 2), _money(line.amount_cents, line.currency or currency), 23, ink, anchor="ra")
        row_y = y + 34
        if line.source_hint:
            text((margin, row_y), line.source_hint, 19, muted, max_w=col_gst - margin - 50)
            row_y += 28
        y = row_y + 14
        draw.rectangle([margin, y - 9, right, y - 8], fill=line_c)
    y += 18

    # Totals
    tlx = right - 360
    for label, value in [
        ("Subtotal (ex GST)", _money(draft.subtotal_cents, currency)),
        ("GST", _money(draft.gst_cents, currency)),
    ]:
        text((tlx, y), label, 21, muted)
        text((col_amt, y), value, 22, ink, anchor="ra")
        y += 38
    draw.rectangle([tlx, y + 2, col_amt, y + 4], fill=ink)
    y += 18
    text((tlx, y), "Total (inc GST)", 26, accent, bold=True)
    text((col_amt, y), _money(draft.total_cents, currency), 30, accent, bold=True, anchor="ra")
    y += 78

    # Payment block (only when configured)
    payment = brand.get("payment") or []
    if payment:
        colw = (width - 2 * margin) // 3
        for idx, (label, value) in enumerate(payment[:3]):
            px = margin + idx * colw
            text((px, y), label.upper(), 17, muted, bold=True, max_w=colw - 24)
            text((px, y + 28), value, 22, ink, bold=True, max_w=colw - 24)
        y += 96

    # Footer
    draw.rectangle([margin, y, right, y + 1], fill=line_c)
    y += 20
    footer = brand.get("footer") or DEFAULT_FOOTER
    if draft.invoice_number:
        footer = f"Please use reference {draft.invoice_number} when paying. " + footer
    _wrap(draw, (margin, y), footer, font(19), muted, width - 2 * margin)
    return img


def _wrap(draw, xy, value, glyph, fill, max_w) -> None:
    x, y = xy
    line = ""
    for word in _safe(value).split():
        trial = (line + " " + word).strip()
        if line and draw.textlength(trial, font=glyph) > max_w:
            draw.text((x, y), line, font=glyph, fill=fill)
            y += 28
            line = word
        else:
            line = trial
    if line:
        draw.text((x, y), line, font=glyph, fill=fill)


def render_invoice_pdf(draft: InvoiceDraft, brand: dict[str, Any]) -> bytes:
    image = _render_invoice_image(draft, brand)
    buf = BytesIO()
    image.save(buf, format="PDF", resolution=150.0)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# HTML preview (shares brand + data with the PDF)
# ---------------------------------------------------------------------------


def render_invoice_html(draft: InvoiceDraft, brand: dict[str, Any]) -> str:
    currency = draft.currency or "AUD"
    accent = escape(brand.get("accent") or DEFAULT_ACCENT)
    rows = "\n".join(
        "<tr>"
        f"<td><div class='desc'>{escape(line.description)}</div>"
        + (f"<div class='sub'>{escape(line.source_hint)}</div>" if line.source_hint else "")
        + "</td>"
        f"<td class='c'>{'10%' if (line.gst_cents or 0) > 0 else 'GST-free'}</td>"
        f"<td class='r'>{escape(_money(line.amount_cents, line.currency or currency))}</td>"
        "</tr>"
        for line in _active_lines(draft)
    )
    issuer_meta = []
    if brand.get("issuer_abn"):
        issuer_meta.append(f"ABN {escape(str(brand['issuer_abn']))}")
    if brand.get("address"):
        issuer_meta.append(escape(str(brand["address"])))
    contact = " · ".join(
        escape(str(x)) for x in [brand.get("contact_email"), brand.get("contact_phone")] if x
    )
    if contact:
        issuer_meta.append(contact)
    issuer_meta_html = "<br>".join(issuer_meta)
    pay_html = ""
    payment = brand.get("payment") or []
    if payment:
        blocks = "".join(
            f"<div class='blk'><div class='label'>{escape(label)}</div>"
            f"<div class='v'>{escape(value)}</div></div>"
            for label, value in payment[:3]
        )
        pay_html = f"<div class='pay'>{blocks}</div>"
    footer = escape(brand.get("footer") or DEFAULT_FOOTER)
    return f"""<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8" />
<title>{escape(draft.invoice_number or 'Tax invoice')}</title>
<style>
  :root {{ --accent: {accent}; --ink:#1b2430; --muted:#5d6b7a; --line:#e2e7ee; }}
  body {{ font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ink); margin:0; background:#f4f5f7; }}
  .sheet {{ max-width:820px; margin:24px auto; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }}
  .bar {{ height:6px; background:var(--accent); }}
  .pad {{ padding:34px 40px; }}
  header {{ display:flex; justify-content:space-between; gap:24px; align-items:flex-start; }}
  .brand {{ display:flex; gap:14px; align-items:center; }}
  .logo {{ width:50px;height:50px;border-radius:11px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:19px; }}
  .brand h1 {{ margin:0; font-size:17px; }}
  .meta {{ color:var(--muted); font-size:12px; margin-top:2px; }}
  .doc {{ text-align:right; }}
  .doc .kicker {{ color:var(--accent); font-weight:700; letter-spacing:1.4px; font-size:11px; text-transform:uppercase; }}
  .doc .num {{ font-size:21px; font-weight:700; }}
  .doc .due {{ margin-top:10px; display:inline-block; background:color-mix(in srgb, var(--accent) 12%, white); color:var(--accent); border-radius:999px; padding:6px 13px; font-weight:700; font-size:13px; }}
  .grid {{ display:grid; grid-template-columns:1.3fr 1fr; gap:26px; margin-top:30px; }}
  .label {{ font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); margin-bottom:5px; }}
  .name {{ font-weight:600; }}
  table {{ width:100%; border-collapse:collapse; margin-top:30px; }}
  thead th {{ text-align:left; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); border-bottom:2px solid var(--line); padding:0 0 9px; }}
  th.r, td.r {{ text-align:right; white-space:nowrap; }} th.c, td.c {{ text-align:center; }}
  tbody td {{ padding:13px 0; border-bottom:1px solid var(--line); vertical-align:top; }}
  tbody .desc {{ font-weight:600; }} tbody .sub {{ color:var(--muted); font-size:12px; margin-top:2px; }}
  .totals {{ display:flex; justify-content:flex-end; margin-top:18px; }}
  .totals table {{ width:300px; margin:0; }} .totals td {{ border:0; padding:5px 0; }} .totals td.r {{ text-align:right; }}
  .totals .k {{ color:var(--muted); }}
  .totals .grand td {{ border-top:2px solid var(--ink); padding-top:11px; font-weight:700; font-size:15px; color:var(--accent); }}
  .pay {{ margin-top:28px; background:#fafbfc; border:1px solid var(--line); border-radius:11px; padding:18px 20px; display:grid; grid-template-columns:repeat(3,1fr); gap:16px 24px; }}
  .pay .v {{ font-weight:600; }}
  .foot {{ margin-top:22px; color:var(--muted); font-size:12px; }}
</style></head>
<body><div class="sheet"><div class="bar"></div><div class="pad">
  <header>
    <div class="brand">
      <div class="logo">{escape(_monogram(brand['issuer_name']))}</div>
      <div><h1>{escape(str(brand['issuer_name']))}</h1><div class="meta">{issuer_meta_html}</div></div>
    </div>
    <div class="doc">
      <div class="kicker">Tax Invoice</div>
      <div class="num">{escape(draft.invoice_number or 'Draft')}</div>
      <div class="due">Amount due {escape(_money(draft.total_cents, currency))}</div>
    </div>
  </header>
  <div class="grid">
    <div><div class="label">Bill to</div>
      <div class="name">{escape(draft.recipient_name or 'Recipient to confirm')}</div>
      <div class="meta">{escape(draft.recipient_email or 'Billing email to confirm')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div><div class="label">Issue date</div><div class="name">{escape(draft.issue_date.isoformat() if draft.issue_date else '-')}</div></div>
      <div><div class="label">Due date</div><div class="name">{escape(draft.due_date.isoformat() if draft.due_date else '-')}</div></div>
    </div>
  </div>
  <table><thead><tr><th>Description</th><th class="c">GST</th><th class="r">Amount (ex GST)</th></tr></thead>
  <tbody>{rows}</tbody></table>
  <div class="totals"><table>
    <tr><td class="k">Subtotal (ex GST)</td><td class="r">{escape(_money(draft.subtotal_cents, currency))}</td></tr>
    <tr><td class="k">GST</td><td class="r">{escape(_money(draft.gst_cents, currency))}</td></tr>
    <tr class="grand"><td>Total (inc GST)</td><td class="r">{escape(_money(draft.total_cents, currency))}</td></tr>
  </table></div>
  {pay_html}
  <div class="foot">{footer}</div>
</div></div></body></html>"""
