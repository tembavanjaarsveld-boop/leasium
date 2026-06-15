import json
from typing import Any

from stewart.ai.document_intake import extract_document_file
from stewart.core.settings import Settings

INVOICE_TEXT = """PAYMENT ADVICE
To: SJI No 1 Pty Ltd
ABN: 97 656 552 699
Email: admin@skjproperty.com.au
Phone: +61 459 380 421
PO Box 5433
Brendale QLD 4500
Customer Gorilla Grind
Invoice Number INV-0331
Amount Due 0.00
Due Date 3 Jun 2026
TAX INVOICE
Gorilla Grind
Invoice Date
31 May 2026
Invoice Number
INV-0331
Reference
Gorilla Grind May 2026
Rent
ABN
97 656 552 699
SJI No 1 Pty Ltd
ABN: 97 656 552 699
Email:
admin@skjproperty.com.au
Description Quantity Unit Price GST Amount AUD
Rent - U1, B3 205 Leitchs Rd Brendale 1.00 3,833.33 10% 3,833.33
Rent - U3, B3 205 Leitchs Rd Brendale 1.00 4,083.33 10% 4,083.33
Subtotal 7,916.66
TOTAL GST 10% 791.66
TOTAL AUD 8,708.32
Less Amount Paid 8,708.32
AMOUNT DUE AUD 0.00
Due Date: 3 Jun 2026
Account name: SJI No 1 Pty Ltd
"""

INVOICE_LAYOUT_TEXT = "\n".join(
    [
        "Invoice Date                SJI No 1 Pty Ltd",
        "TAX INVOICE                 31 May 2026                 ABN: 97 656 552 699",
        "Invoice Number              Email:",
        "Gorilla Grind               INV-0331                    admin@skjproperty.com.au",
        "Reference",
        "Gorilla Grind May 2026",
        "Rent",
        "Description Quantity Unit Price GST Amount AUD",
        "Rent - U1, B3 205 Leitchs Rd Brendale 1.00 3,833.33 10% 3,833.33",
        "Rent - U3, B3 205 Leitchs Rd Brendale 1.00 4,083.33 10% 4,083.33",
        "TOTAL AUD                8,708.32",
        "Less Amount Paid               8,708.32",
        "AMOUNT DUE AUD                        0.00",
        "Due Date: 3 Jun 2026",
        "PAYMENT ADVICE",
        "Customer              Gorilla Grind",
        "To:        SJI No 1 Pty Ltd                                               Amount Enclosed",
        "ABN: 97 656 552 699",
        "Email: admin@skjproperty.com.au",
    ]
)


def _empty_invoice_extraction() -> dict[str, Any]:
    return {
        "document_type": "invoice_admin",
        "summary": (
            "Tax invoice for Gorilla Grind issued by SJI No 1 Pty Ltd for May "
            "2026 rent across two premises."
        ),
        "confidence": 0.88,
        "parties": [],
        "properties": [],
        "key_dates": [],
        "money_amounts": [],
        "tenancy_schedule": [],
        "obligations": [],
        "suggested_links": {
            "property_name": None,
            "tenant_name": None,
            "lease_reference": None,
        },
        "warnings": [],
        "missing_information": [],
        "proposed_actions": [],
        "inspection_findings": [],
    }


class _FakeOpenAIResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return {
            "id": "resp_empty_invoice",
            "output": [
                {
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps(_empty_invoice_extraction()),
                        }
                    ]
                }
            ],
        }


class _FakeHTTPClient:
    def __init__(self, *, timeout: float) -> None:
        self.timeout = timeout

    def __enter__(self) -> "_FakeHTTPClient":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def post(self, *args: object, **kwargs: object) -> _FakeOpenAIResponse:
        return _FakeOpenAIResponse()


def test_extract_document_file_supplements_empty_invoice_from_source_text(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr("stewart.ai.document_intake.httpx.Client", _FakeHTTPClient)

    extracted, response_id = extract_document_file(
        file_data=INVOICE_TEXT.encode(),
        filename="Invoice INV-0331.txt",
        content_type="text/plain",
        settings=Settings(openai_api_key="sk-test"),
    )

    assert response_id == "resp_empty_invoice"
    assert extracted["document_type"] == "invoice_admin"
    assert extracted["suggested_links"]["tenant_name"] == "Gorilla Grind"
    assert extracted["suggested_links"]["property_name"] == "205 Leitchs Rd Brendale"
    assert [party["name"] for party in extracted["parties"]] == [
        "Gorilla Grind",
        "SJI No 1 Pty Ltd",
    ]
    assert extracted["properties"][0]["address"] == "205 Leitchs Rd Brendale"
    assert extracted["properties"][0]["unit_label"] == "U1, B3; U3, B3"
    assert extracted["key_dates"] == [
        {
            "label": "Invoice date",
            "date": "2026-05-31",
            "confidence": 0.9,
            "source_hint": "Invoice Date 31 May 2026",
        },
        {
            "label": "Payment due",
            "date": "2026-06-03",
            "confidence": 0.9,
            "source_hint": "Due Date 3 Jun 2026",
        },
    ]
    assert extracted["money_amounts"][0] == {
        "label": "Total rent invoice including GST",
        "amount": 8708.32,
        "currency": "AUD",
        "frequency": "monthly",
        "confidence": 0.9,
        "source_hint": "TOTAL AUD 8,708.32",
    }
    assert extracted["proposed_actions"][0]["action"] == "prepare_billing_review"
    assert any("Amount Due AUD 0.00" in warning for warning in extracted["warnings"])


def test_extract_document_file_supplements_column_layout_invoice_text(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr("stewart.ai.document_intake.httpx.Client", _FakeHTTPClient)

    extracted, _response_id = extract_document_file(
        file_data=INVOICE_LAYOUT_TEXT.encode(),
        filename="Invoice INV-0331.txt",
        content_type="text/plain",
        settings=Settings(openai_api_key="sk-test"),
    )

    assert extracted["parties"][1]["name"] == "SJI No 1 Pty Ltd"
    assert extracted["properties"][0]["invoice_reference"] == "INV-0331"
    assert extracted["properties"][0]["invoice_issuer_name"] == "SJI No 1 Pty Ltd"
    assert extracted["money_amounts"][0]["frequency"] == "monthly"
